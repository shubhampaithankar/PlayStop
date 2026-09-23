import { Router } from "express";
import { rateLimit } from "#middleware/rate-limit.js";
import { requestOtp, verifyOtp } from "#modules/otp/controller.js";

export const otpRouter = Router({ mergeParams: true });

otpRouter.post("/request", rateLimit, requestOtp);
otpRouter.post("/verify", rateLimit, verifyOtp);
