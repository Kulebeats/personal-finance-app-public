/**
 * Household Module - Routes
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { householdController } from "./household.controller";

const router = Router();
router.use(requireAuth);

// General settings
router.get("/general", householdController.getGeneral);
router.post("/", householdController.create);
router.put("/general", householdController.updateGeneral);

// Member management
router.get("/members", householdController.getMembers);
router.put("/members/:userId/role", householdController.updateMemberRole);
router.delete("/members/:userId", householdController.removeMember);

// Invitation system
router.post("/invite", householdController.inviteMember);
router.post("/invite/accept", householdController.acceptInvite);
router.post("/invitations/:inviteId/resend", householdController.resendInvite);
router.get("/invitations", householdController.getInvitations);
router.delete("/invitations/:inviteId", householdController.cancelInvitation);

// Ownership and membership
router.post("/transfer-ownership", householdController.transferOwnership);
router.post("/leave", householdController.leaveHousehold);

export default router;
