/**
 * Login Page
 *
 * Handles authentication flow: login, registration, and MFA verification.
 * Split into components to stay under 300 LOC limit.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import logo from "@assets/generated_images/modern_abstract_butterfly_finance_logo.png";
import { LoginForm, RegisterForm, MfaVerifyForm } from "./components";
import {
  handleLoginApi,
  handleRegisterApi,
  handleMfaVerifyApi,
  handleResendMfaApi,
  handleResendVerificationApi,
} from "./useAuthHandlers";
import { readReturnPath } from "@/lib/returnPath";

export default function Login() {
  const [, setLocation] = useLocation();
  // `?next=` (validated same-origin path) and `?mode=register` let links such
  // as the household invite page send the user back after signing in.
  const [returnPath] = useState(() => readReturnPath(window.location.search));
  const [isLogin, setIsLogin] = useState(
    () => new URLSearchParams(window.location.search).get("mode") !== "register",
  );
  const [isLoading, setIsLoading] = useState(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  // Register form state
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerFullName, setRegisterFullName] = useState("");

  // MFA state
  const [isMfaVerify, setIsMfaVerify] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isBackupCode, setIsBackupCode] = useState(false);

  // Password visibility
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const autoHideTimerRef = useRef<NodeJS.Timeout>();
  const [capsLockOn, setCapsLockOn] = useState(false);

  // Load remembered email
  useEffect(() => {
    const savedEmail = localStorage.getItem("rememberedEmail");
    const savedRememberMe = localStorage.getItem("rememberMe") === "true";
    if (savedEmail && savedRememberMe) {
      setLoginEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
    };
  }, []);

  const handleTogglePassword = useCallback(
    (currentlyShowing: boolean, setShowing: (show: boolean) => void) => {
      if (!currentlyShowing) {
        setShowing(true);
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = setTimeout(() => setShowing(false), 3000);
      } else {
        setShowing(false);
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      }
    },
    [],
  );

  const handleKeyEvent = useCallback((e: React.KeyboardEvent) => {
    setCapsLockOn(e.getModifierState("CapsLock"));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setShowResendVerification(false);
    try {
      const result = await handleLoginApi({ email: loginEmail, password: loginPassword, rememberMe });
      if (result.success) {
        if (result.requiresMfa) {
          setIsMfaVerify(true);
          setMaskedEmail(result.maskedEmail || "your email");
          toast.message("Please enter the verification code sent to your email");
        } else {
          if (rememberMe) {
            localStorage.setItem("rememberedEmail", loginEmail);
            localStorage.setItem("rememberMe", "true");
          } else {
            localStorage.removeItem("rememberedEmail");
            localStorage.removeItem("rememberMe");
          }
          toast.success("Logged in successfully!");
          setLocation(returnPath);
        }
      } else {
        setShowResendVerification(!!result.isEmailNotVerified);
        toast.error(result.message || "Login failed");
      }
    } catch (error) {
      toast.error("Failed to connect to server: " + (error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!loginEmail) { toast.error("Enter your email address first"); return; }
    setIsResendingVerification(true);
    try {
      const result = await handleResendVerificationApi(loginEmail);
      toast[result.success ? "success" : "error"](result.success ? "Verification email sent" : result.message!);
    } catch { toast.error("Failed to connect to server"); }
    finally { setIsResendingVerification(false); }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await handleMfaVerifyApi(mfaCode);
      if (result.success) { toast.success("MFA verified successfully!"); setLocation(returnPath); }
      else toast.error(result.message || "MFA verification failed");
    } catch { toast.error("Failed to connect to server"); }
    finally { setIsLoading(false); }
  };

  const handleResendMfa = async () => {
    if (resendCooldown > 0) return;
    const result = await handleResendMfaApi();
    if (result.success) {
      toast.success("Code resent successfully");
      setResendCooldown(60);
      if (result.maskedEmail) setMaskedEmail(result.maskedEmail);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await handleRegisterApi({
        username: registerUsername, email: registerEmail,
        password: registerPassword, fullName: registerFullName,
      });
      if (result.success) { toast.success("Account created successfully!"); setLocation(returnPath); }
      else toast.error(result.message || "Registration failed");
    } catch { toast.error("Failed to connect to server"); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 via-white to-purple-50 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl overflow-hidden bg-primary/20 flex items-center justify-center">
              <img src={logo} alt="Capital Logo" className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="text-center">
            <CardTitle className="text-2xl font-bold">{isLogin ? "Welcome Back" : "Create Account"}</CardTitle>
            <CardDescription>{isLogin ? "Sign in to manage your finances" : "Start tracking your finances today"}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {isMfaVerify ? (
            <MfaVerifyForm mfaCode={mfaCode} setMfaCode={setMfaCode} isBackupCode={isBackupCode}
              setIsBackupCode={setIsBackupCode} maskedEmail={maskedEmail} isLoading={isLoading}
              resendCooldown={resendCooldown} onSubmit={handleMfaVerify} onResend={handleResendMfa}
              onBack={() => { setIsMfaVerify(false); setMfaCode(""); }} />
          ) : isLogin ? (
            <LoginForm loginEmail={loginEmail} setLoginEmail={setLoginEmail} loginPassword={loginPassword}
              setLoginPassword={setLoginPassword} rememberMe={rememberMe} setRememberMe={setRememberMe}
              showPassword={showLoginPassword} capsLockOn={capsLockOn} isLoading={isLoading}
              showResendVerification={showResendVerification} isResendingVerification={isResendingVerification}
              onSubmit={handleLogin} onTogglePassword={() => handleTogglePassword(showLoginPassword, setShowLoginPassword)}
              onKeyEvent={handleKeyEvent} onResendVerification={handleResendVerification} onSwitchToRegister={() => setIsLogin(false)} />
          ) : (
            <RegisterForm fullName={registerFullName} setFullName={setRegisterFullName} username={registerUsername}
              setUsername={setRegisterUsername} email={registerEmail} setEmail={setRegisterEmail}
              password={registerPassword} setPassword={setRegisterPassword} showPassword={showRegisterPassword}
              capsLockOn={capsLockOn} isLoading={isLoading} onSubmit={handleRegister}
              onTogglePassword={() => handleTogglePassword(showRegisterPassword, setShowRegisterPassword)}
              onKeyEvent={handleKeyEvent} onSwitchToLogin={() => setIsLogin(true)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
