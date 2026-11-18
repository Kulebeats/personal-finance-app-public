/**
 * Auth Module Routes - API v1 (P3-49)
 *
 * Versioned API routes for authentication.
 * This file provides the v1 API contract that will remain stable.
 *
 * Mount at: /api/v1/auth
 *
 * @module modules/auth/auth.routes.v1
 */

import { Router } from "express";
import { authController } from "./auth.controller";
import { requireAuth } from "../../auth";
import { authLimiter } from "../../middleware/rateLimit";

const router = Router();

/**
 * @api {post} /api/v1/auth/register Register new user
 * @apiVersion 1.0.0
 * @apiName Register
 * @apiGroup Auth
 *
 * @apiBody {String} email User email
 * @apiBody {String} username Username (3-50 chars, alphanumeric + _ -)
 * @apiBody {String} password Password (8+ chars, upper, lower, number)
 * @apiBody {String} [fullName] Full name
 *
 * @apiSuccess {Boolean} success true
 * @apiSuccess {Object} data.user User object (without password)
 */
router.post("/register", authLimiter, authController.register);

/**
 * @api {post} /api/v1/auth/login Login user
 * @apiVersion 1.0.0
 * @apiName Login
 * @apiGroup Auth
 *
 * @apiBody {String} email User email
 * @apiBody {String} password User password
 * @apiBody {Boolean} [rememberMe=false] Extended session (30 days vs 24 hours)
 *
 * @apiSuccess {Boolean} success true
 * @apiSuccess {Object} data.user User object
 * @apiSuccess {Boolean} [data.requiresMfa] true if MFA verification needed
 */
router.post("/login", authLimiter, authController.login);

/**
 * @api {post} /api/v1/auth/mfa/verify Verify MFA code
 * @apiVersion 1.0.0
 * @apiName VerifyMfa
 * @apiGroup Auth
 *
 * @apiBody {String} email User email
 * @apiBody {String} code 6-digit MFA code
 *
 * @apiSuccess {Boolean} success true
 * @apiSuccess {Object} data.user User object
 */
router.post("/mfa/verify", authLimiter, authController.verifyMfa);

/**
 * @api {post} /api/v1/auth/logout Logout user
 * @apiVersion 1.0.0
 * @apiName Logout
 * @apiGroup Auth
 * @apiPermission authenticated
 *
 * @apiSuccess {Boolean} success true
 * @apiSuccess {String} message "Logged out successfully"
 */
router.post("/logout", requireAuth, authController.logout);

/**
 * @api {get} /api/v1/auth/me Get current user
 * @apiVersion 1.0.0
 * @apiName GetCurrentUser
 * @apiGroup Auth
 * @apiPermission authenticated
 *
 * @apiSuccess {Boolean} success true
 * @apiSuccess {Object} data.user Current user object
 */
router.get("/me", requireAuth, authController.getCurrentUser);

export default router;
