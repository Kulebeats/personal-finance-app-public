import { assertOperationLifetime, captureOperationLifetime } from "@/lib/operation-lifetime";

/** Capture authority before asynchronous camera data conversion begins. */
export async function prepareCameraFile(image: string): Promise<File> {
  const operation = captureOperationLifetime();
  const response = await fetch(image);
  const blob = await response.blob();
  assertOperationLifetime(operation);
  return new File([blob], "camera-capture.jpg", { type: "image/jpeg" });
}
