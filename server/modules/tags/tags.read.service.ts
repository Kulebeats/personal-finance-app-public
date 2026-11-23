import { tagReadRepository, type TagListOptions } from "../../repositories/TagReadRepository";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { Tag } from "@shared/schema";
import { parseTagId } from "./tags.validation";

const compareName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byUsage = (a: { name: string; id: string; usageCount: number }, b: { name: string; id: string; usageCount: number }) =>
  b.usageCount - a.usageCount || compareName(a, b);

class TagReadService {
  listTags(actor: HouseholdContext, options?: TagListOptions) { return tagReadRepository.list(actor, options); }
  getTagById(id: string, actor: HouseholdContext) { return tagReadRepository.get(actor, parseTagId(id)); }
  getTransactionTags(id: string, actor: HouseholdContext) { return tagReadRepository.transactionTags(actor, parseTagId(id)); }
  getTagTransactions(id: string, actor: HouseholdContext, limit = 50, offset = 0) {
    return tagReadRepository.page(actor, parseTagId(id), limit, offset);
  }
  async projectMutationTag(actor: HouseholdContext, row: Tag | undefined) {
    return row ? (await tagReadRepository.mutationTags(actor, [row]))[0] : undefined;
  }
  projectMutationTags(actor: HouseholdContext, rows: Tag[]) { return tagReadRepository.mutationTags(actor, rows); }
  projectMutationTransactionTags(actor: HouseholdContext, id: string) { return tagReadRepository.mutationTransactionTags(actor, id); }

  async getTagAnalytics(actor: HouseholdContext, limit: number = 20) {
    const allTags = await tagReadRepository.list(actor);

    // Sort by usage count
    const sortedTags = allTags
      .sort(byUsage)
      .slice(0, limit);

    const totalTags = allTags.length;
    const totalUsage = allTags.reduce((sum, tag) => sum + (tag.usageCount || 0), 0);
    const averageUsage = totalTags > 0 ? totalUsage / totalTags : 0;

    return {
      topTags: sortedTags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        usageCount: tag.usageCount || 0,
        percentage: totalUsage > 0 ? ((tag.usageCount || 0) / totalUsage) * 100 : 0,
      })),
      summary: {
        totalTags,
        totalUsage,
        averageUsage: Number(averageUsage.toFixed(2)),
      },
    };
  }

  async suggestTags(
    actor: HouseholdContext,
    options: {
      transactionName?: string;
      merchantName?: string;
      limit?: number;
    }
  ): Promise<
    Array<{
      id: string;
      name: string;
      color: string | null;
      confidence: number;
      reason: string;
    }>
  > {
    const { transactionName, merchantName, limit = 5 } = options;
    const suggestions: Array<{
      id: string;
      name: string;
      color: string | null;
      confidence: number;
      reason: string;
    }> = [];

    // Get all household tags
    const allTags = await tagReadRepository.list(actor);
    if (allTags.length === 0) {
      return [];
    }

    // Search terms to match against
    const searchTerms = [
      transactionName?.toLowerCase(),
      merchantName?.toLowerCase(),
    ].filter(Boolean) as string[];

    if (searchTerms.length === 0) {
      // No search terms - return most used tags
      const sortedTags = [...allTags].sort(
        byUsage
      );
      return sortedTags.slice(0, limit).map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        confidence: 0.5,
        reason: "frequently_used",
      }));
    }

    // Score each tag based on name matching
    for (const tag of allTags) {
      const tagNameLower = tag.name.toLowerCase();
      let maxConfidence = 0;
      let reason = "no_match";

      for (const term of searchTerms) {
        // Exact match
        if (tagNameLower === term) {
          maxConfidence = Math.max(maxConfidence, 0.95);
          reason = "exact_match";
        }
        // Tag name contains search term
        else if (term.includes(tagNameLower)) {
          maxConfidence = Math.max(maxConfidence, 0.85);
          reason = "term_contains_tag";
        }
        // Search term contains tag name
        else if (tagNameLower.includes(term)) {
          maxConfidence = Math.max(maxConfidence, 0.75);
          reason = "tag_contains_term";
        }
        // Partial word match
        else {
          const tagWords = tagNameLower.split(/\s+/);
          const termWords = term.split(/\s+/);
          for (const tagWord of tagWords) {
            for (const termWord of termWords) {
              if (tagWord === termWord) {
                maxConfidence = Math.max(maxConfidence, 0.7);
                reason = "word_match";
              } else if (
                tagWord.includes(termWord) ||
                termWord.includes(tagWord)
              ) {
                maxConfidence = Math.max(maxConfidence, 0.5);
                reason = "partial_word_match";
              }
            }
          }
        }
      }

      // Boost confidence by usage (more used = more likely correct)
      const usageBoost = Math.min((tag.usageCount || 0) / 100, 0.1);
      maxConfidence = Math.min(maxConfidence + usageBoost, 0.99);

      if (maxConfidence > 0.3) {
        suggestions.push({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          confidence: Number(maxConfidence.toFixed(2)),
          reason,
        });
      }
    }

    // Sort by confidence and return top N
    return suggestions
      .sort((a, b) => b.confidence - a.confidence || compareName(a, b))
      .slice(0, limit);
  }
}

export const tagReadService = new TagReadService();
