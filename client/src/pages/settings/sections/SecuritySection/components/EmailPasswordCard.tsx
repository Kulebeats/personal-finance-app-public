import React, { useState } from "react";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  X,
} from "lucide-react";
import {
  useSecurityStatus,
  useChangeEmail,
  useResendVerification,
  useCancelEmailChange,
} from "@/hooks/useSecurity";
import { useChangePassword, calculatePasswordStrength } from "@/hooks/use-settings";

export function EmailPasswordCard() {
  const { data: security, isLoading } = useSecurityStatus();
  const changeEmail = useChangeEmail();
  const resendVerification = useResendVerification();
  const cancelEmailChange = useCancelEmailChange();
  const changePassword = useChangePassword();

  const [showEditEmail, setShowEditEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const passwordStrength = calculatePasswordStrength(newPassword);

  const handleEmailChange = () => {
    changeEmail.mutate(
      { newEmail, password: emailPassword },
      {
        onSuccess: () => {
          setShowEditEmail(false);
          setNewEmail("");
          setEmailPassword("");
        },
      }
    );
  };

  const handlePasswordChange = () => {
    const errors: string[] = [];
    if (!currentPassword) errors.push("Current password is required");
    if (newPassword.length < 8)
      errors.push("Password must be at least 8 characters");
    if (!/[A-Z]/.test(newPassword))
      errors.push("Password must contain uppercase letter");
    if (!/[a-z]/.test(newPassword))
      errors.push("Password must contain lowercase letter");
    if (!/[0-9]/.test(newPassword))
      errors.push("Password must contain a number");
    if (newPassword !== confirmPassword) errors.push("Passwords do not match");

    setPasswordErrors(errors);

    if (errors.length === 0) {
      changePassword.mutate(
        { currentPassword, newPassword, confirmPassword },
        {
          onSuccess: () => {
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setPasswordErrors([]);
          },
        }
      );
    }
  };

  if (isLoading) {
    return (
      <SettingsCard
        title="Email & Password"
        description="Manage your login credentials"
      >
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Email & Password"
      description="Manage your login credentials"
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Email</Label>
            <Dialog open={showEditEmail} onOpenChange={setShowEditEmail}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Edit email
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Change Email Address</DialogTitle>
                  <DialogDescription>
                    Enter your new email and current password to verify the
                    change.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-email">New Email</Label>
                    <Input
                      id="new-email"
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="new@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email-password">Current Password</Label>
                    <Input
                      id="email-password"
                      type="password"
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      placeholder="Enter your password"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowEditEmail(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleEmailChange}
                    disabled={
                      !newEmail || !emailPassword || changeEmail.isPending
                    }
                  >
                    {changeEmail.isPending ? "Sending..." : "Send Verification"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <p className="font-medium">{security?.email}</p>
              {security?.pendingEmail && (
                <p className="text-sm text-muted-foreground">
                  Pending: {security.pendingEmail}
                </p>
              )}
            </div>
            {security?.emailVerified ? (
              <Badge
                variant="default"
                className="bg-green-500 hover:bg-green-600"
              >
                <CheckCircle className="w-3 h-3 mr-1" />
                Verified
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-800"
              >
                <AlertCircle className="w-3 h-3 mr-1" />
                Unverified
              </Badge>
            )}
          </div>

          {security?.pendingEmail && (
            <div className="flex items-center gap-2 text-sm">
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-primary"
                onClick={() => resendVerification.mutate()}
                disabled={resendVerification.isPending}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Resend verification
              </Button>
              <span className="text-muted-foreground">-</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-destructive"
                onClick={() => cancelEmailChange.mutate()}
                disabled={cancelEmailChange.isPending}
              >
                <X className="w-3 h-3 mr-1" />
                Cancel change
              </Button>
            </div>
          )}

          {!security?.emailVerified && !security?.pendingEmail && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => resendVerification.mutate()}
              disabled={resendVerification.isPending}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Send verification email
            </Button>
          )}
        </div>

        <div className="border-t border-border" />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Password</Label>
              <p className="text-sm text-muted-foreground">
                {security?.hasPassword
                  ? "Change your account password"
                  : "Create a password to login without social accounts"}
              </p>
            </div>
          </div>

          <div className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="current-password"
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="pl-10 pr-10"
                  placeholder="Enter current password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pl-10 pr-10"
                  placeholder="Enter new password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {newPassword && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5, 6].map((level) => (
                      <div
                        key={level}
                        className={`h-1 flex-1 rounded-full ${
                          passwordStrength.score >= level
                            ? passwordStrength.color
                            : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Strength: {passwordStrength.label}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 pr-10"
                  placeholder="Confirm new password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {passwordErrors.length > 0 && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <ul className="text-sm text-destructive space-y-1">
                  {passwordErrors.map((error, i) => (
                    <li key={i}>- {error}</li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              onClick={handlePasswordChange}
              disabled={
                changePassword.isPending || !currentPassword || !newPassword
              }
            >
              {changePassword.isPending ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
