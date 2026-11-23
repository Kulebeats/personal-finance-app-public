import { distance } from "fastest-levenshtein";
import { merchantRepository, type Merchant } from "../repositories/MerchantRepository";
import { eq } from "drizzle-orm";
import { merchants } from "@shared/schema";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { addMerchantAliasIfFree } from "../modules/merchants/merchants.name-guard";

const NOISE_WORDS = new Set([
  "pos",
  "purchase",
  "purch",
  "debit",
  "credit",
  "card",
  "visa",
  "mastercard",
  "auth",
  "authcode",
  "ref",
  "reference",
  "txn",
  "transaction",
  "trn",
  "transfer",
  "trf",
  "payment",
  "pay",
  "online",
  "mobile",
  "atm",
  "withdrawal",
  "deposit",
  "fee",
  "fees",
  "charge",
  "charges",
  "bal",
  "balance",
  "avail",
  "available",
  "statement",
]);

const MIN_FUZZY_SCORE = 0.84;
const MIN_ALIAS_LENGTH = 3;

export type MerchantMatch = {
  cleanedName: string;
  merchant?: Merchant;
  matchType?: "id" | "alias" | "exact" | "fuzzy";
  score?: number;
  aliasCandidate?: string | null;
};

export function normalizeMerchantName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanMerchantName(value: string): string {
  if (!value) return "";
  const normalized = value
    .replace(/[_*#]/g, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/[^a-zA-Z0-9&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  const filtered = normalized
    .split(" ")
    .filter((word) => word && !NOISE_WORDS.has(word.toLowerCase()))
    .join(" ");

  if (!filtered) return "";

  return filtered
    .split(" ")
    .map((word) => {
      const upper = word.toUpperCase();
      if (word.length <= 3 || word === upper) {
        return upper;
      }
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function similarityScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.92;
  if (a.includes(b) || b.includes(a)) return 0.86;
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;
  return 1 - distance(a, b) / maxLen;
}

function getAliasCandidate(
  rawName: string,
  cleanedName: string,
  merchantName: string
): string | null {
  const candidate = cleanedName || rawName.trim();
  if (!candidate) return null;
  if (candidate.length < MIN_ALIAS_LENGTH) return null;
  if (!/[a-zA-Z]/.test(candidate)) return null;

  const normalizedCandidate = normalizeMerchantName(candidate);
  const normalizedMerchant = normalizeMerchantName(merchantName);
  if (!normalizedCandidate || normalizedCandidate === normalizedMerchant) {
    return null;
  }

  return candidate;
}

export async function ensureMerchantAlias(
  merchantId: string,
  aliasName: string,
  tx?: TransactionType,
): Promise<void> {
  const trimmed = aliasName.trim();
  if (!trimmed || trimmed.length < MIN_ALIAS_LENGTH) return;

  // Names and aliases share one household namespace (merchants.name-guard):
  // a learned alias another merchant already claims is skipped, not stolen.
  const learn = async (writeTx: TransactionType): Promise<void> => {
    const [merchant] = await writeTx
      .select({ householdId: merchants.householdId })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!merchant?.householdId) return;
    await addMerchantAliasIfFree(writeTx, merchant.householdId, merchantId, trimmed);
  };
  if (tx) await learn(tx);
  else await withTransaction(learn);
}

export async function resolveMerchantMatch(params: {
  householdId: string;
  rawName: string;
  merchantId?: string | null;
  allowFuzzy?: boolean;
}): Promise<MerchantMatch> {
  const { householdId, rawName, merchantId, allowFuzzy = true } = params;
  const trimmedRaw = rawName.trim();
  const cleanedName = cleanMerchantName(trimmedRaw) || trimmedRaw;

  let merchant: Merchant | undefined;
  let matchType: MerchantMatch["matchType"];
  let score: number | undefined;

  if (merchantId) {
    merchant = await merchantRepository.findByIdAndHousehold(
      merchantId,
      householdId
    );
    if (merchant) {
      matchType = "id";
    }
  }

  if (!merchant && trimmedRaw) {
    merchant = await merchantRepository.findByNameOrAlias(
      householdId,
      trimmedRaw
    );
    if (merchant) {
      matchType = "alias";
    }
  }

  if (!merchant && cleanedName && cleanedName !== trimmedRaw) {
    merchant = await merchantRepository.findByNameOrAlias(
      householdId,
      cleanedName
    );
    if (merchant) {
      matchType = "exact";
    }
  }

  if (!merchant && allowFuzzy && cleanedName) {
    const normalizedCandidate = normalizeMerchantName(cleanedName);
    if (normalizedCandidate) {
      const candidates = await merchantRepository.search(
        householdId,
        cleanedName
      );
      let best: { merchant: Merchant; score: number } | null = null;
      for (const candidate of candidates) {
        const candidateNormalized = normalizeMerchantName(candidate.name);
        const candidateScore = similarityScore(
          normalizedCandidate,
          candidateNormalized
        );
        if (!best || candidateScore > best.score) {
          best = { merchant: candidate, score: candidateScore };
        }
      }

      if (best && best.score >= MIN_FUZZY_SCORE) {
        merchant = best.merchant;
        matchType = "fuzzy";
        score = best.score;
      }
    }
  }

  const aliasCandidate = merchant
    ? getAliasCandidate(trimmedRaw, cleanedName, merchant.name)
    : null;

  return {
    cleanedName,
    merchant,
    matchType,
    score,
    aliasCandidate,
  };
}
