import { Router } from "express";

const router = Router();
// Already-issued registration links remain usable. Resolve before sessions so
// following a link cannot consume a capability or alter the visiting identity.
router.get("/auth/verify-email", (req, res) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const token = req.query.token;
  if (token !== undefined && (typeof token !== "string" || token.length > 256)) {
    res.status(400).json({ success: false, error: { code: "INVALID_LINK", message: "Invalid verification link" } });
    return;
  }
  const query = token === undefined ? "" : `?${new URLSearchParams({ token })}`;
  res.redirect(302, `/verify-email${query}`);
});
export default router;
