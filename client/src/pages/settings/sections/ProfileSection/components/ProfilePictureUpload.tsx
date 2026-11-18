import React, { useState, useRef, useCallback, useEffect } from "react";
import Webcam from "react-webcam";
import { Camera, Trash2, X, Loader2, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormContext } from "react-hook-form";
import {
  useProfile,
  useUploadProfilePicture,
  useDeleteProfilePicture,
} from "@/hooks/use-settings";

// Generate a gradient background based on initials
function getInitialsGradient(name: string): string {
  const gradients = [
    "from-rose-400 to-pink-500",
    "from-violet-400 to-purple-500",
    "from-blue-400 to-indigo-500",
    "from-cyan-400 to-teal-500",
    "from-emerald-400 to-green-500",
    "from-amber-400 to-orange-500",
    "from-red-400 to-rose-500",
    "from-fuchsia-400 to-pink-500",
  ];

  // Use name to generate a consistent gradient
  const hash = name
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return gradients[hash % gradients.length];
}

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

interface InitialsAvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

function InitialsAvatar({
  name,
  size = "md",
  className = "",
}: InitialsAvatarProps) {
  const sizeClasses = {
    sm: "w-[200px] h-[200px] text-7xl",
    md: "w-40 h-40 text-5xl",
    lg: "w-40 h-40 text-5xl",
  };

  const gradient = getInitialsGradient(name || "User");
  const initials = getInitials(name || "User");

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-linear-to-br ${gradient} flex items-center justify-center text-white font-semibold shadow-lg ${className}`}
    >
      {initials}
    </div>
  );
}

export function ProfilePictureUpload() {
  const { setValue, watch } = useFormContext();
  const { data: profile } = useProfile();
  const uploadPicture = useUploadProfilePicture();
  const deletePicture = useDeleteProfilePicture();

  const [showPictureModal, setShowPictureModal] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("upload");
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const webcamRef = useRef<Webcam>(null);

  const formValue = watch("profilePicture");
  const profilePictureUrl = formValue || profile?.profilePictureUrl;
  const userName = profile?.fullName || profile?.displayName || "";

  // Check for camera availability
  useEffect(() => {
    async function checkCamera() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(
          (device) => device.kind === "videoinput"
        );
        setHasCamera(videoDevices.length > 0);
      } catch {
        setHasCamera(false);
      }
    }
    checkCamera();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("File size must be less than 5MB");
        return;
      }
      uploadPicture.mutate(file, {
        onSuccess: (data) => {
          setValue("profilePicture", data.pictureUrl, { shouldDirty: true });
          setShowPictureModal(false);
        },
      });
    }
    e.target.value = "";
  };

  const capturePhoto = useCallback(() => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        setCapturedImage(imageSrc);
      }
    }
  }, []);

  const uploadCapturedPhoto = useCallback(async () => {
    if (!capturedImage) return;

    // Convert base64 to blob
    const res = await fetch(capturedImage);
    const blob = await res.blob();
    const file = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });

    uploadPicture.mutate(file, {
      onSuccess: (data) => {
        setValue("profilePicture", data.pictureUrl, { shouldDirty: true });
        setCapturedImage(null);
        setShowPictureModal(false);
      },
    });
  }, [capturedImage, uploadPicture, setValue]);

  const retakePhoto = () => {
    setCapturedImage(null);
  };

  const handleCameraError = useCallback(() => {
    setCameraError(
      "Unable to access camera. Please check your browser permissions."
    );
  }, []);

  const closeModal = () => {
    setShowPictureModal(false);
    setCapturedImage(null);
    setCameraError(null);
  };

  return (
    <div className="space-y-4">
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex flex-col md:flex-row items-center md:items-end gap-6">
        {/* Avatar with camera button overlay - 200px */}
        <div
          className="relative cursor-pointer group shrink-0"
          onClick={() => setShowPictureModal(true)}
        >
          {/* Main avatar circle */}
          {profilePictureUrl ? (
            <img
              src={profilePictureUrl}
              alt="Profile"
              className="w-[200px] h-[200px] rounded-full object-cover object-center bg-muted border-[6px] border-background shadow-xl transition-transform group-hover:scale-[1.02]"
            />
          ) : (
            <InitialsAvatar
              name={userName}
              size="sm"
              className="border-[6px] border-background shadow-xl"
            />
          )}

          {/* Camera button overlay */}
          <div className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-primary border-4 border-background flex items-center justify-center text-primary-foreground group-hover:bg-primary/90 transition-colors shadow-lg">
            <Camera className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Profile Picture Modal */}
      {showPictureModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200"
          onClick={closeModal}
        >
          <div
            className="bg-card rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 text-center border-b relative">
              <h3 className="font-semibold">Profile Picture</h3>
              <button
                type="button"
                onClick={closeModal}
                className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs for Upload / Camera */}
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList
                className="grid w-full grid-cols-2 mx-4 mt-4"
                style={{ width: "calc(100% - 2rem)" }}
              >
                <TabsTrigger value="upload" className="flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Upload
                </TabsTrigger>
                {hasCamera && (
                  <TabsTrigger
                    value="camera"
                    className="flex items-center gap-2"
                  >
                    <Video className="w-4 h-4" />
                    Camera
                  </TabsTrigger>
                )}
                {!hasCamera && (
                  <TabsTrigger
                    value="camera"
                    disabled
                    className="flex items-center gap-2 opacity-50"
                  >
                    <Video className="w-4 h-4" />
                    No Camera
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Upload Tab */}
              <TabsContent value="upload" className="mt-0">
                {/* Large Avatar Preview - 160px */}
                <div className="p-8 flex justify-center bg-muted/20">
                  {profilePictureUrl ? (
                    <img
                      src={profilePictureUrl}
                      alt="Profile"
                      className="w-40 h-40 rounded-full object-cover object-center border-4 border-background shadow-lg"
                    />
                  ) : (
                    <InitialsAvatar
                      name={userName}
                      size="lg"
                      className="border-4 border-background"
                    />
                  )}
                </div>

                {/* Action Buttons */}
                <div className="p-4 flex flex-col gap-3 border-t">
                  <Button
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadPicture.isPending}
                  >
                    {uploadPicture.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        {profilePictureUrl ? "Change Photo" : "Upload Photo"}
                      </>
                    )}
                  </Button>

                  {profilePictureUrl && (
                    <Button
                      variant="outline"
                      className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (
                          confirm(
                            "Are you sure you want to remove your profile picture?"
                          )
                        ) {
                          deletePicture.mutate(undefined, {
                            onSuccess: () => {
                              setValue("profilePicture", null, {
                                shouldDirty: true,
                              });
                              setShowPictureModal(false);
                            },
                          });
                        }
                      }}
                      disabled={deletePicture.isPending}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove Photo
                    </Button>
                  )}
                </div>
              </TabsContent>

              {/* Camera Tab */}
              <TabsContent value="camera" className="mt-0">
                <div className="p-4 flex flex-col items-center bg-muted/20">
                  {cameraError ? (
                    <div className="w-full aspect-square max-w-[320px] rounded-lg bg-muted flex items-center justify-center text-center p-4">
                      <p className="text-sm text-muted-foreground">
                        {cameraError}
                      </p>
                    </div>
                  ) : capturedImage ? (
                    <div className="relative">
                      <img
                        src={capturedImage}
                        alt="Captured"
                        className="w-40 h-40 rounded-full object-cover object-center border-4 border-background shadow-lg"
                      />
                    </div>
                  ) : (
                    <div className="relative rounded-lg overflow-hidden">
                      <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        screenshotQuality={0.9}
                        videoConstraints={{
                          width: 640,
                          height: 640,
                          facingMode: "user",
                        }}
                        onUserMediaError={handleCameraError}
                        className="w-full max-w-[320px] rounded-lg"
                        mirrored
                      />
                      {/* Circular overlay guide */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-48 h-48 rounded-full border-4 border-white/50 border-dashed" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Camera Action Buttons */}
                <div className="p-4 flex flex-col gap-3 border-t">
                  {capturedImage ? (
                    <>
                      <Button
                        className="w-full"
                        onClick={uploadCapturedPhoto}
                        disabled={uploadPicture.isPending}
                      >
                        {uploadPicture.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" />
                            Use This Photo
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={retakePhoto}
                        disabled={uploadPicture.isPending}
                      >
                        <Camera className="w-4 h-4 mr-2" />
                        Retake
                      </Button>
                    </>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={capturePhoto}
                      disabled={!!cameraError}
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Take Photo
                    </Button>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}
