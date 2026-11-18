/**
 * TagsList Component
 *
 * Displays a list of tags with edit/delete/merge/archive actions and transaction counts.
 * CODE-004: Shows member-specific tags with owner indicator.
 * FUNC-001: Tag merge functionality
 * FUNC-002: Tag archive functionality
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Archive,
  Loader2,
  Merge,
  MoreHorizontal,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTags, useDeleteTag, useMergeTags, useArchiveTag } from "@/hooks";
import { TagModal } from "./TagModal";
import type { Tag } from "@/lib/api";

export function TagsList() {
  const { data: tags, isLoading, error } = useTags();
  const deleteTag = useDeleteTag();
  const mergeTags = useMergeTags();
  const archiveTag = useArchiveTag();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null);
  const [archivingTag, setArchivingTag] = useState<Tag | null>(null);

  // Merge state
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);
  const [targetTagId, setTargetTagId] = useState<string>("");

  const handleEdit = (tag: Tag) => {
    setEditingTag(tag);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditingTag(null);
    setModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingTag) return;
    try {
      await deleteTag.mutateAsync(deletingTag.id);
      setDeletingTag(null);
    } catch {
      // Error handled by mutation
    }
  };

  const handleArchive = async () => {
    if (!archivingTag) return;
    try {
      await archiveTag.mutateAsync(archivingTag.id);
      setArchivingTag(null);
    } catch {
      // Error handled by mutation
    }
  };

  const handleMerge = async () => {
    if (selectedForMerge.length === 0 || !targetTagId) return;
    const sourceIds = selectedForMerge.filter((id) => id !== targetTagId);
    if (sourceIds.length === 0) return;

    try {
      await mergeTags.mutateAsync({
        sourceTagIds: sourceIds,
        targetTagId,
      });
      setMergeDialogOpen(false);
      setSelectedForMerge([]);
      setTargetTagId("");
    } catch {
      // Error handled by mutation
    }
  };

  const toggleMergeSelection = (tagId: string) => {
    setSelectedForMerge((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  };

  const openMergeDialog = () => {
    setSelectedForMerge([]);
    setTargetTagId("");
    setMergeDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading tags...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Failed to load tags. Please try again.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Tags</h3>
        <div className="flex items-center gap-2">
          {tags && tags.length >= 2 && (
            <Button onClick={openMergeDialog} size="sm" variant="outline">
              <Merge className="h-4 w-4 mr-1" />
              Merge tags
            </Button>
          )}
          <Button onClick={handleCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New tag
          </Button>
        </div>
      </div>

      {/* Tags list */}
      {tags && tags.length > 0 ? (
        <div className="divide-y rounded-lg border">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: tag.color || "#A3A3A3" }}
                  aria-hidden="true"
                />
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{tag.name}</span>
                    {/* CODE-004: Member-specific tag indicator */}
                    {tag.memberSpecific && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs">
                        <User className="h-3 w-3" aria-hidden="true" />
                        <span>Personal</span>
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {tag.usageCount || 0} {tag.usageCount === 1 ? "transaction" : "transactions"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(tag)}
                  aria-label={`Edit ${tag.name} tag`}
                >
                  Edit
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`More actions for ${tag.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setArchivingTag(tag)}>
                      <Archive className="h-4 w-4 mr-2" />
                      Archive
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeletingTag(tag)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground border rounded-lg">
          <p>No tags yet.</p>
          <p className="text-sm mt-1">
            Create tags to organize your transactions.
          </p>
        </div>
      )}

      {/* Create/Edit Modal */}
      <TagModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        tag={editingTag}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingTag}
        onOpenChange={(open) => !open && setDeletingTag(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingTag?.name}"? This will
              remove the tag from all transactions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTag.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive Confirmation */}
      <AlertDialog
        open={!!archivingTag}
        onOpenChange={(open) => !open && setArchivingTag(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive tag?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive "{archivingTag?.name}"? The tag
              will be removed from your active list but transaction history will
              be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>
              {archiveTag.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Archive className="h-4 w-4 mr-2" />
              )}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge Tags Dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge Tags</DialogTitle>
            <DialogDescription>
              Select tags to merge and choose a target tag. All transactions
              from selected tags will be moved to the target tag.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select tags to merge</Label>
              <div className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-2">
                {tags?.map((tag) => (
                  <div
                    key={tag.id}
                    className="flex items-center gap-3 p-2 hover:bg-muted rounded"
                  >
                    <Checkbox
                      id={`merge-${tag.id}`}
                      checked={selectedForMerge.includes(tag.id)}
                      onCheckedChange={() => toggleMergeSelection(tag.id)}
                      aria-label={`Select ${tag.name} for merge`}
                    />
                    <span
                      className="h-3 w-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color || "#A3A3A3" }}
                      aria-hidden="true"
                    />
                    <label
                      htmlFor={`merge-${tag.id}`}
                      className="flex-1 cursor-pointer text-sm"
                    >
                      {tag.name}
                      <span className="text-muted-foreground ml-2">
                        ({tag.usageCount || 0})
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {selectedForMerge.length >= 2 && (
              <div className="space-y-2">
                <Label htmlFor="target-tag">Merge into (target tag)</Label>
                <Select value={targetTagId} onValueChange={setTargetTagId}>
                  <SelectTrigger id="target-tag">
                    <SelectValue placeholder="Select target tag" />
                  </SelectTrigger>
                  <SelectContent>
                    {tags
                      ?.filter((tag) => selectedForMerge.includes(tag.id))
                      .map((tag) => (
                        <SelectItem key={tag.id} value={tag.id}>
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: tag.color || "#A3A3A3" }}
                            />
                            {tag.name}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedForMerge.length - 1} tag(s) will be merged into the
                  target and deleted.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMergeDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={
                selectedForMerge.length < 2 ||
                !targetTagId ||
                mergeTags.isPending
              }
            >
              {mergeTags.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Merge className="h-4 w-4 mr-2" />
              )}
              Merge Tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
