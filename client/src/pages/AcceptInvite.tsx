/**
 * Accept Invitation page — the target of the household invitation email
 * (`${APP_URL}/invite/<inviteCode>`, server/modules/household/
 * invitations.controller.ts).
 *
 * Public route: signed-out visitors get sign-in / create-account links that
 * return here; signed-in users can accept via POST /api/household/invite/accept.
 * The server has no public "look up invitation by code" endpoint, so the
 * household name and role are not shown before accepting.
 */
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Loader2, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/use-settings";
import { apiCall, type ApiError } from "@/lib/api";
import { buildLoginHref } from "@/lib/returnPath";

const HTTP_UNAUTHORIZED = 401;
const INVALIDATED_QUERY_KEYS = [["household"], ["householdMembers"], ["profile"]];

interface ErrorCopy {
  title: string;
  message: string;
}

/**
 * Map the server's error to a heading. The body is the server's own message,
 * which distinguishes expired / already used / already a member (all 409
 * CONFLICT in invitations.controller.ts acceptInvite).
 */
function describeAcceptError(error: ApiError): ErrorCopy {
  const message = error.message || "Something went wrong. Please try again.";
  switch (error.code) {
    case "NOT_FOUND":
      return { title: "Invitation not found", message };
    case "CONFLICT":
      return { title: "This invitation can't be used", message };
    case "VALIDATION_ERROR":
      return { title: "Invalid invitation link", message };
    case "UNAUTHORIZED":
      return { title: "Please sign in again", message };
    case "RATE_LIMIT_EXCEEDED":
      return { title: "Too many attempts", message };
    default:
      return { title: "Couldn't accept the invitation", message };
  }
}

function ErrorAlert({ title, message }: ErrorCopy) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800"
    >
      <AlertCircle
        className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="text-sm text-red-700 dark:text-red-300">
        <p className="font-medium">{title}</p>
        <p className="mt-1">{message}</p>
      </div>
    </div>
  );
}

function SignedOutActions({ returnPath }: { returnPath: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground text-center">
        Sign in or create an account to accept it. You'll come back to this
        page afterwards.
      </p>
      <Button asChild className="w-full">
        <Link href={buildLoginHref(returnPath)}>Sign in</Link>
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link href={buildLoginHref(returnPath, "register")}>Create account</Link>
      </Button>
    </div>
  );
}

export default function AcceptInvite() {
  const { code = "" } = useParams<{ code: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: profile, isLoading, error: profileError } = useProfile();
  const returnPath = `/invite/${encodeURIComponent(code)}`;

  const accept = useMutation<unknown, ApiError>({
    mutationFn: () =>
      apiCall("/household/invite/accept", {
        method: "POST",
        body: JSON.stringify({ inviteCode: code }),
      }),
    onSuccess: async () => {
      await Promise.all(
        INVALIDATED_QUERY_KEYS.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      toast.success("You've joined the household");
      setLocation("/");
    },
  });

  const profileStatus = (profileError as ApiError | null)?.status;
  const hasProfileLoadError =
    !!profileError && profileStatus !== HTTP_UNAUTHORIZED;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-purple-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="w-8 h-8 text-primary" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">
            <h1>You've been invited</h1>
          </CardTitle>
          <CardDescription className="text-base">
            Someone has invited you to join their household and share its
            finances with them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div
              role="status"
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2
                className="w-4 h-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Checking your sign-in status...
            </div>
          ) : profile ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Signed in as{" "}
                <span className="font-medium text-foreground">
                  {profile.email}
                </span>
                . Accepting adds this account to the household.
              </p>
              {accept.error && (
                <ErrorAlert {...describeAcceptError(accept.error)} />
              )}
              <Button
                className="w-full"
                onClick={() => accept.mutate()}
                disabled={accept.isPending || !code}
                aria-busy={accept.isPending}
              >
                {accept.isPending && (
                  <Loader2
                    className="w-4 h-4 mr-2 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {accept.isPending ? "Accepting..." : "Accept invitation"}
              </Button>
            </div>
          ) : (
            <>
              {hasProfileLoadError && (
                <ErrorAlert
                  title="Couldn't check your sign-in status"
                  message={profileError.message}
                />
              )}
              <SignedOutActions returnPath={returnPath} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
