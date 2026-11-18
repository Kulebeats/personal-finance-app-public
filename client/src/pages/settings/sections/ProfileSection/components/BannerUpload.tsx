import React, { useState, useRef } from "react";
import { ImagePlus, Trash2, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFormContext } from "react-hook-form";
import { apiCall } from "@/lib/api";

interface BannerUploadProps {
  bannerUrl?: string | null;
  userName?: string;
}

// Server responses use the V7 envelope: { success, data: { bannerUrl } }.
interface BannerEnvelope {
  data?: { bannerUrl?: string | null };
}

// Exported for tests: mutations must go through apiCall so they carry
// x-csrf-token (raw fetch 403s in a real browser session).
export async function uploadBannerRequest(
  file: File,
): Promise<{ bannerUrl?: string | null }> {
  const formData = new FormData();
  formData.append("banner", file);

  const res = await apiCall<BannerEnvelope>("/settings/profile/banner", {
    method: "POST",
    body: formData,
  });
  return { bannerUrl: res.data?.bannerUrl };
}

export async function deleteBannerRequest(): Promise<unknown> {
  return apiCall<unknown>("/settings/profile/banner", { method: "DELETE" });
}

export function BannerUpload({
  bannerUrl: initialBannerUrl,
  userName,
}: BannerUploadProps) {
  const { setValue, watch } = useFormContext();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showModal, setShowModal] = useState(false);

  const formValue = watch("bannerUrl");
  const bannerUrl = formValue || initialBannerUrl;

  // Upload banner mutation
  const uploadBanner = useMutation({
    mutationFn: uploadBannerRequest,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setValue("bannerUrl", data.bannerUrl, { shouldDirty: true });
      toast({
        title: "Banner updated",
        description: "Your cover photo has been updated successfully.",
      });
      setShowModal(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete banner mutation
  const deleteBanner = useMutation({
    mutationFn: deleteBannerRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setValue("bannerUrl", null, { shouldDirty: true });
      toast({
        title: "Banner removed",
        description: "Your cover photo has been removed.",
      });
      setShowModal(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Banner image must be less than 5MB",
          variant: "destructive",
        });
        return;
      }
      uploadBanner.mutate(file);
    }
    e.target.value = "";
  };

  // Generate gradient for default banner
  const getDefaultGradient = (name: string): string => {
    const gradients = [
      "from-blue-400 via-purple-500 to-pink-500",
      "from-emerald-400 via-cyan-500 to-blue-500",
      "from-orange-400 via-red-500 to-pink-500",
      "from-violet-400 via-purple-500 to-indigo-500",
      "from-teal-400 via-emerald-500 to-green-500",
    ];
    const hash = (name || "User")
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return gradients[hash % gradients.length];
  };

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Banner Display */}
      {/* Banner Display - Tall 256px height */}
      <div
        className="relative w-full h-64 rounded-xl overflow-hidden cursor-pointer group shadow-sm bg-muted"
        onClick={() => setShowModal(true)}
      >
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt="Profile banner"
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div
            className={`w-full h-full bg-linear-to-r ${getDefaultGradient(
              userName || ""
            )}`}
          />
        )}

        {/* Edit Button Overlay - Top Right */}
        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="bg-black/50 hover:bg-black/70 text-white px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 backdrop-blur-sm border border-white/20 shadow-lg">
            <ImagePlus className="w-4 h-4" />
            <span>Edit Cover</span>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-card rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 text-center border-b relative">
              <h3 className="font-semibold">Cover Photo</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Preview */}
            <div className="p-4">
              <div className="w-full h-40 rounded-lg overflow-hidden">
                {bannerUrl ? (
                  <img
                    src={bannerUrl}
                    alt="Banner preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div
                    className={`w-full h-full bg-linear-to-r ${getDefaultGradient(
                      userName || ""
                    )}`}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Recommended size: 1500 x 500 pixels
              </p>
            </div>

            {/* Actions */}
            <div className="p-4 flex flex-col gap-3 border-t">
              <Button
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadBanner.isPending}
              >
                {uploadBanner.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <ImagePlus className="w-4 h-4 mr-2" />
                    {bannerUrl ? "Change Photo" : "Upload Photo"}
                  </>
                )}
              </Button>

              {bannerUrl && (
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    if (
                      confirm(
                        "Are you sure you want to remove your cover photo?"
                      )
                    ) {
                      deleteBanner.mutate();
                    }
                  }}
                  disabled={deleteBanner.isPending}
                >
                  {deleteBanner.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Removing...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove Photo
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
