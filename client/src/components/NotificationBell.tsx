import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Bell, Check, ExternalLink, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
  type Notification,
} from "@/hooks/useNotifications";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";

/**
 * NotificationBell
 *
 * Bell icon with unread count badge and dropdown panel.
 * Polls for unread count every 30 seconds.
 */
export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [loadingNotificationId, setLoadingNotificationId] = useState<
    string | null
  >(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const bellButtonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [, setLocation] = useLocation();

  // Hooks
  const { data: unreadCount = 0 } = useUnreadCount();
  const {
    data: notifications = [],
    isLoading,
    error,
    refetch,
  } = useNotifications({
    limit: 10,
    enabled: isOpen, // Only fetch when dropdown is open
  });
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        // Return focus to bell button when clicking outside
        bellButtonRef.current?.focus();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        bellButtonRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && notifications.length > 0) {
      itemRefs.current[0]?.focus();
    }
  }, [isOpen, notifications.length]);

  // Handle notification click
  function handleNotificationClick(notification: Notification) {
    // Mark as read
    if (!notification.isRead) {
      setLoadingNotificationId(notification.id);
      markAsRead.mutate(notification.id, {
        onSettled: () => {
          setLoadingNotificationId(null);
        },
      });
      setAnnouncement("Notification marked as read");
    }

    // Navigate if action URL exists
    if (notification.actionUrl) {
      setLocation(notification.actionUrl);
      setIsOpen(false);
    }
  }

  // Handle mark all as read
  function handleMarkAllAsRead() {
    const count = notifications.filter((n) => !n.isRead).length;
    markAllAsRead.mutate();
    setAnnouncement(`Marked ${count} notifications as read`);
  }

  function handleItemKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      itemRefs.current[index + 1]?.focus();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      itemRefs.current[index - 1]?.focus();
    }
    if (event.key === "Home") {
      event.preventDefault();
      itemRefs.current[0]?.focus();
    }
    if (event.key === "End") {
      event.preventDefault();
      itemRefs.current[itemRefs.current.length - 1]?.focus();
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      {/* Bell Button */}
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setIsOpen(!isOpen)}
        ref={bellButtonRef}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Notifications${
          unreadCount > 0 ? ` (${unreadCount} unread)` : ""
        }`}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-lg"
          role="menu"
          aria-label="Notifications"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="font-semibold" id="notifications-heading">Notifications</h3>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-primary"
                onClick={handleMarkAllAsRead}
                disabled={markAllAsRead.isPending}
                aria-label="Mark all notifications as read"
              >
                <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                Mark all read
              </Button>
            )}
          </div>

          {/* Content */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="sr-only">Loading notifications</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-8 px-4">
                <p className="text-sm text-red-500 dark:text-red-400 mb-3 text-center">
                  Failed to load notifications
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  aria-label="Retry loading notifications"
                >
                  Try Again
                </Button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                <Bell className="mb-2 h-8 w-8 opacity-50" aria-hidden="true" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {notifications.map((notification, index) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-muted relative",
                        !notification.isRead &&
                          "bg-blue-50/50 dark:bg-blue-900/10",
                        loadingNotificationId === notification.id &&
                          "opacity-60"
                      )}
                      onClick={() => handleNotificationClick(notification)}
                      onKeyDown={(event) => handleItemKeyDown(event, index)}
                      ref={(el) => (itemRefs.current[index] = el)}
                      role="menuitem"
                      disabled={loadingNotificationId === notification.id}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0 flex items-start gap-2">
                          {!notification.isRead && (
                            <Circle
                              className="h-2 w-2 mt-1.5 fill-blue-500 text-blue-500 shrink-0"
                              aria-label="Unread"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p
                              className={cn(
                                "text-sm truncate",
                                !notification.isRead && "font-semibold"
                              )}
                            >
                              {notification.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                              {notification.body}
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                              {formatDistanceToNow(
                                new Date(notification.createdAt),
                                {
                                  addSuffix: true,
                                }
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {loadingNotificationId === notification.id && (
                            <>
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
                              <span className="sr-only">Marking as read</span>
                            </>
                          )}
                          {notification.actionUrl && (
                            <ExternalLink className="h-4 w-4 text-gray-400" aria-hidden="true" />
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-border px-4 py-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => {
                  setLocation("/settings/notifications");
                  setIsOpen(false);
                }}
              >
                Notification Settings
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
