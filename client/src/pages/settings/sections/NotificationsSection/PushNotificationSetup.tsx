import { toastActionError } from "@/lib/actionErrorToast";
import { protectedFetch } from "@/lib/protected-fetch";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { apiCall } from "@/lib/api";
import { throwIfResNotOk } from "@/lib/queryClient";
import { assertOperationLifetime, captureOperationLifetime, StaleOperationError, type OperationLifetime } from "@/lib/operation-lifetime";

// Exported for tests: mutations must go through apiCall so they carry
// x-csrf-token (raw fetch 403s in a real browser session).
export async function saveSubscription(
  subscription: PushSubscription,
  operation = captureOperationLifetime(),
): Promise<void> {
  await apiCall<unknown>("/notifications/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  }, true, false, operation);
}

export async function removeSubscription(endpoint: string, operation = captureOperationLifetime()): Promise<void> {
  await apiCall<unknown>("/notifications/push/unsubscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  }, true, false, operation);
}

/**
 * Push Notification Setup Component
 *
 * Handles browser push notification subscription/unsubscription.
 * Requires service worker and VAPID keys to be configured on the server.
 */
export function PushNotificationSetup() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [subscriptionEndpoint, setSubscriptionEndpoint] = useState<string | null>(
    null,
  );

  useEffect(() => {
    // Check if push notifications are supported
    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setIsSupported(supported);

    if (supported) {
      checkSubscription();
    }
  }, []);

  function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function ensureServiceWorkerRegistration() {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      return existing;
    }

    return navigator.serviceWorker.register("/sw.js");
  }

  async function fetchVapidPublicKey(operation: OperationLifetime | null) {
    assertOperationLifetime(operation);
    const response = await protectedFetch("/api/notifications/push/vapid-key", {
      credentials: "include",
    });

    await throwIfResNotOk(response);

    const payload = await response.json();
    const publicKey = payload?.data?.publicKey ?? payload?.publicKey;
    if (!publicKey) {
      throw new Error("Missing VAPID public key");
    }

    return publicKey as string;
  }

  // A browser subscription is re-sent so the server binds it to this session
  // (after an expiry, a new sign-in, or a row saved before sessions were
  // recorded). Push shows as on only once the server has it.
  async function checkSubscription() {
    const operation = captureOperationLifetime();
    try {
      const registration = await ensureServiceWorkerRegistration();
      assertOperationLifetime(operation);
      const subscription = await registration.pushManager.getSubscription();
      assertOperationLifetime(operation);
      if (!subscription) {
        setIsSubscribed(false);
        setSubscriptionEndpoint(null);
        return;
      }
      await saveSubscription(subscription, operation);
      setIsSubscribed(true);
      setSubscriptionEndpoint(subscription.endpoint);
    } catch (error) {
      if (error instanceof StaleOperationError) return;
      console.error("Failed to check push subscription", error);
      setIsSubscribed(false);
      setSubscriptionEndpoint(null);
    }
  }

  async function handleSubscribe() {
    const operation = captureOperationLifetime();
    setIsLoading(true);
    try {
      const permission = await Notification.requestPermission();
      assertOperationLifetime(operation);

      if (permission !== "granted") {
        toast.error("Push notifications permission denied");
        return;
      }

      const registration = await ensureServiceWorkerRegistration();
      assertOperationLifetime(operation);
      const vapidPublicKey = await fetchVapidPublicKey(operation);
      assertOperationLifetime(operation);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      assertOperationLifetime(operation);
      await saveSubscription(subscription, operation);

      setIsSubscribed(true);
      setSubscriptionEndpoint(subscription.endpoint);
      toast.success("Push notifications enabled");
    } catch (error) {
      if (error instanceof StaleOperationError) return;
      console.error("Failed to subscribe to push notifications", error);
      toastActionError("Failed to enable push notifications", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUnsubscribe() {
    const operation = captureOperationLifetime();
    setIsLoading(true);
    try {
      const registration = await ensureServiceWorkerRegistration();
      assertOperationLifetime(operation);
      const subscription = await registration.pushManager.getSubscription();
      assertOperationLifetime(operation);

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        assertOperationLifetime(operation);
        await removeSubscription(endpoint, operation);
      }

      setIsSubscribed(false);
      setSubscriptionEndpoint(null);
      toast.success("Unsubscribed from push notifications");
    } catch (error) {
      if (error instanceof StaleOperationError) return;
      console.error("Failed to unsubscribe from push notifications", error);
      toastActionError("Failed to unsubscribe", error);
    } finally {
      setIsLoading(false);
    }
  }

  if (!isSupported) {
    return (
      <Card className="border-orange-200 dark:border-orange-900">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-500" />
            <CardTitle className="text-base">Push Notifications</CardTitle>
          </div>
          <CardDescription>
            Push notifications are not supported in your browser
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            <CardTitle className="text-base">Push Notifications</CardTitle>
          </div>
          {isSubscribed && (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Active
            </Badge>
          )}
        </div>
        <CardDescription>
          Receive instant notifications even when the app is closed
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Browser Push Notifications
            </p>
            <p className="text-xs text-muted-foreground">
              {isSubscribed
                ? "You'll receive push notifications for enabled notification types"
                : "Click subscribe to enable push notifications"}
            </p>
          </div>
          <Button
            variant={isSubscribed ? "outline" : "default"}
            size="sm"
            onClick={isSubscribed ? handleUnsubscribe : handleSubscribe}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2" />
                {isSubscribed ? "Unsubscribing..." : "Subscribing..."}
              </>
            ) : isSubscribed ? (
              <>
                <BellOff className="w-4 h-4 mr-2" />
                Unsubscribe
              </>
            ) : (
              <>
                <Bell className="w-4 h-4 mr-2" />
                Subscribe
              </>
            )}
          </Button>
        </div>

        {isSubscribed && subscriptionEndpoint && (
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <p className="font-medium mb-1">Active Subscription</p>
            <p>
              You're subscribed to receive push notifications. You can manage which types of
              notifications trigger push alerts using the toggles above.
            </p>
            <p className="mt-2 break-all text-[10px] text-muted-foreground/70">
              Endpoint: {subscriptionEndpoint}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
