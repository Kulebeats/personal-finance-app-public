/**
 * Sign-out stops pushes to this browser. The server has already removed the
 * subscription registered from the session; dropping it at the push service
 * too means a later sign-in starts without one. Best effort: a browser
 * without a service worker or push support has nothing to drop, and a
 * failure here cannot undo a completed sign-out.
 */
export async function unsubscribeThisBrowserFromPush(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch (error) {
    console.warn("Could not drop this browser's push subscription after sign-out", error);
  }
}
