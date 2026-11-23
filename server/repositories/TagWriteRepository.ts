import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { accounts, householdMembers, households, tags, transactionTags, transactions } from "@shared/schema";
import type { HouseholdContext } from "../middleware/householdGuard";
import { can, isHouseholdRole } from "../core/authz/capabilities";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../core/errors";
import { businessAuditService } from "../services/BusinessAuditService";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { lockTagNames, normalizeTagName } from "../modules/tags/tags.name-guard";
import { z } from "zod";

type Operation = "add" | "set" | "remove";
type Command = { operation: Operation; transactionId: string; tagIds: string[] };
const commandSchema = z.object({
  operation: z.enum(["add", "set", "remove"]), transactionId: z.string().uuid(), tagIds: z.array(z.string().uuid()),
}).strict();
const actorSchema = z.object({ householdId: z.string().uuid(), userId: z.string().uuid(), role: z.unknown() });
const conflict = () => new ConflictError("Tag state requires reconciliation");

/** Validated transaction tag writes, including the initial tags on an account CSV posting. */
class TagWriteRepository {
  write(inputActor: HouseholdContext, input: Command, ipAddress?: string) {
    return this.writeCommand(inputActor, input, ipAddress);
  }

  /** Acquire tag-writer locks before the new posting takes the ordinary account lock. */
  async prepareImport(tx: TransactionType, householdId: string, userId: string, names: string[]) {
    // Serialize tag writers while permitting household FK checks on concurrent ordinary postings.
    const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("no key update");
    if (!household) throw new NotFoundError("Household not found");
    // A tag can name another member. Acquire memberships in the existing tag writer's
    // order, before any account or transaction row, including for a newly created tag.
    const members = await tx.select({ id: householdMembers.userId, role: householdMembers.role }).from(householdMembers)
      .where(eq(householdMembers.householdId, householdId)).orderBy(asc(householdMembers.userId)).for("update");
    const actor = members.find(member => member.id === userId);
    if (!actor || !isHouseholdRole(actor.role) || !can(actor.role, "financial.write")) throw new ForbiddenError("Financial write access required");
    // The household tag-name lock (NEW-36), after the memberships and before any account row,
    // so a concurrent create or rename of the same name runs before or after this import.
    await lockTagNames(tx, householdId);
    const tagIds: string[] = [];
    // The same trimmed NFC form tag create and rename store (N5, A-33), so an import reuses their tag.
    const normalized = new Map(names.map(normalizeTagName).map(name => [name.toLowerCase(), name]));
    for (const name of normalized.values()) {
      // One name per household in any case (uq_tags_household_name), so at most one row matches.
      const find = async () => (await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.householdId, householdId),
        sql`lower(${tags.name}) = lower(${name})`)).limit(1))[0]?.id;
      // A receipt match creates its tag without the lock; the unique index decides, and this re-reads.
      const id = await find()
        ?? (await tx.insert(tags).values({ householdId, name }).onConflictDoNothing().returning({ id: tags.id }))[0]?.id
        ?? await find();
      if (!id) throw conflict();
      tagIds.push(id);
    }
    const subject = { householdId, userId, role: actor.role };
    return (transactionId: string) => this.writeCommand(subject, { operation: "add", transactionId, tagIds }, undefined, tx);
  }

  private async writeCommand(inputActor: HouseholdContext, input: Command, ipAddress?: string, existingTx?: TransactionType) {
    if (!inputActor || !can(inputActor.role, "financial.write")) throw new ForbiddenError("Financial write access required");
    const parsedActor = actorSchema.safeParse(inputActor);
    if (!parsedActor.success) throw new ValidationError("Invalid actor identifiers");
    const actor = { householdId: parsedActor.data.householdId.toLowerCase(), userId: parsedActor.data.userId.toLowerCase(), role: inputActor.role };
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success || (input.operation === "remove" && input.tagIds.length !== 1)) throw new ValidationError("Invalid transaction tag command");
    // PostgreSQL returns lowercase UUIDs; normalize valid input before set
    // operations and identity comparisons, including direct service callers.
    const command = { ...parsed.data, transactionId: parsed.data.transactionId.toLowerCase(),
      tagIds: [...new Set(parsed.data.tagIds.map((id) => id.toLowerCase()))].sort() };
    const write = async (tx: TransactionType) => {
      const [household] = await tx.select({ id: households.id }).from(households)
        .where(eq(households.id, actor.householdId)).for("no key update");
      if (!household) throw new NotFoundError("Household not found");
      // Discovery is only for ordered membership locks. Authoritative links and
      // tag references are read again after their containing rows are locked.
      const candidates = await this.links(tx, command.transactionId);
      const candidateTagIds = [...new Set([...command.tagIds, ...candidates.map((row) => row.tagId)])];
      const candidateTags = candidateTagIds.length ? await tx.select({ memberId: tags.memberId }).from(tags)
        .where(and(eq(tags.householdId, actor.householdId), inArray(tags.id, candidateTagIds))) : [];
      const memberIds = [...new Set([actor.userId, ...candidateTags.flatMap((tag) => tag.memberId ? [tag.memberId] : [])])].sort();
      const members = await tx.select({ userId: householdMembers.userId, role: householdMembers.role }).from(householdMembers)
        .where(and(eq(householdMembers.householdId, actor.householdId), inArray(householdMembers.userId, memberIds)))
        .orderBy(asc(householdMembers.userId)).for("update");
      const member = members.find((row) => row.userId === actor.userId);
      if (!member || !can(member.role, "financial.write")) throw new ForbiddenError("Financial write access required");

      const [transaction] = await tx.select().from(transactions)
        .where(and(eq(transactions.id, command.transactionId), eq(transactions.householdId, actor.householdId))).for("update");
      if (!transaction || transaction.deletedAt || (transaction.isPrivate !== false && transaction.ownerUserId !== actor.userId)) throw new NotFoundError("Transaction not found");
      const [account] = await tx.select().from(accounts)
        .where(and(eq(accounts.id, transaction.accountId), eq(accounts.householdId, actor.householdId))).for("update");
      if (!account || account.deletedAt || (account.isPrivate !== false && account.ownerUserId !== actor.userId)) throw new NotFoundError("Transaction not found");

      // The transaction lock serializes these commands. Legacy writers may not
      // participate: discover, lock the tag union, then refuse any new reference.
      const previous = await this.links(tx, command.transactionId);
      const tagIds = [...new Set([...command.tagIds, ...previous.map((row) => row.tagId)])].sort();
      const lockedTags = tagIds.length ? await tx.select().from(tags)
        .where(and(eq(tags.householdId, actor.householdId), inArray(tags.id, tagIds))).orderBy(asc(tags.id)).for("update") : [];
      if (lockedTags.length !== tagIds.length) throw new NotFoundError("Tag not found");
      for (const tag of lockedTags) {
        if (!tag.memberId) continue;
        if (!memberIds.includes(tag.memberId)) throw new ConflictError("Tag references changed; retry the request");
        if (!members.some((row) => row.userId === tag.memberId && isHouseholdRole(row.role))) throw new NotFoundError("Tag not found");
      }
      const current = await this.links(tx, command.transactionId, true);
      if (current.some((row) => !tagIds.includes(row.tagId))) throw new ConflictError("Tag references changed; retry the request");
      for (const tag of lockedTags) {
        const [count] = await tx.select({ value: sql<number>`count(*)::int`.mapWith(Number) })
          .from(transactionTags).where(eq(transactionTags.tagId, tag.id));
        if (!Number.isSafeInteger(tag.usageCount) || tag.usageCount! < 0 || tag.usageCount !== count.value) throw conflict();
      }

      const oldIds = current.map((row) => row.tagId);
      const removeIds = command.operation === "set" ? oldIds.filter((id) => !command.tagIds.includes(id))
        : command.operation === "remove" ? command.tagIds : [];
      const addIds = command.operation === "remove" ? [] : command.tagIds.filter((id) => !oldIds.includes(id));
      const removed = removeIds.length ? await tx.delete(transactionTags)
        .where(and(eq(transactionTags.transactionId, command.transactionId), inArray(transactionTags.tagId, removeIds)))
        .returning({ tagId: transactionTags.tagId }) : [];
      const added = addIds.length ? await tx.insert(transactionTags)
        .values(addIds.map((tagId) => ({ transactionId: command.transactionId, tagId }))).onConflictDoNothing()
        .returning({ tagId: transactionTags.tagId }) : [];
      for (const { tagId } of removed) await tx.update(tags).set({ usageCount: sql`${tags.usageCount} - 1` }).where(eq(tags.id, tagId));
      for (const { tagId } of added) await tx.update(tags).set({ usageCount: sql`${tags.usageCount} + 1` }).where(eq(tags.id, tagId));

      await businessAuditService.log({
        tx, householdId: actor.householdId, userId: actor.userId, entityType: "transaction", entityId: command.transactionId,
        action: command.operation === "add" ? "LINK" : command.operation === "remove" ? "UNLINK" : "UPDATE",
        details: { operation: command.operation === "add" ? "add_tags" : command.operation === "remove" ? "remove_tag" : "set_tags",
          addedTagIds: added.map((row) => row.tagId), removedTagIds: removed.map((row) => row.tagId) }, ipAddress,
      });
      // A commit result, not raw Tag rows/global counters. Public hydration
      // remains the controller's existing actor-visible postcommit projection.
      return { added: added.length, removed: removed.length };
    };
    return existingTx ? write(existingTx) : withTransaction(write);
  }

  private links(tx: TransactionType, transactionId: string, lock = false) {
    const query = tx.select({ tagId: transactionTags.tagId }).from(transactionTags)
      .where(eq(transactionTags.transactionId, transactionId)).orderBy(asc(transactionTags.tagId));
    return lock ? query.for("update") : query;
  }
}

export const tagWriteRepository = new TagWriteRepository();
