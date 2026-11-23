import { ProtectedImage } from "@/components/session/ProtectedImage";
import { useRef, useState, type ChangeEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGoalImages, useUploadGoalImage } from "@/hooks/useGoals";

type GoalImagePickerProps = {
  value: string;
  onChange: (url: string) => void;
};

export function GoalImagePicker({ value, onChange }: GoalImagePickerProps) {
  const { data: images = [], isLoading } = useGoalImages();
  const uploadImage = useUploadGoalImage();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const uploaded = await uploadImage.mutateAsync(file);
      onChange(uploaded.url);
    } catch {
      return;
    }
    event.target.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-16 w-16 overflow-hidden rounded-lg border bg-muted/40">
          {value ? (
            <ProtectedImage src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadImage.isPending}
            >
              {uploadImage.isPending ? "Uploading..." : "Upload image"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setLibraryOpen(true)}
            >
              Choose from library
            </Button>
            {value ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange("")}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Upload a photo or pick from your saved images.
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="goal-image-url">Image URL (optional)</Label>
        <Input
          id="goal-image-url"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://example.com/goal.jpg"
        />
      </div>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Select an image</DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading library...</p>
          ) : images.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No uploaded images yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => {
                    onChange(image.url);
                    setLibraryOpen(false);
                  }}
                  className="overflow-hidden rounded-lg border hover:border-primary transition-colors"
                >
                  <ProtectedImage
                    src={image.url}
                    alt={image.originalFilename}
                    className="h-24 w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
