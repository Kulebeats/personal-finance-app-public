ALTER TABLE "goals"
  DROP CONSTRAINT "chk_goal_target_positive",
  ADD CONSTRAINT "chk_goal_target_positive"
    CHECK ("goals"."target_amount" > 0 OR ("goals"."type" = 'pay_down' AND "goals"."target_amount" = 0));
