import type { User } from "@shared/schema";
import { nrcFromStorage } from "../../core/personal-data/nrc";

/** General identity responses never expose credentials or private profile data. */
export function toPublicUserDto(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    fullName: user.fullName,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    timezone: user.timezone,
    profilePictureUrl: user.profilePictureUrl,
    bannerUrl: user.bannerUrl,
    bio: user.bio,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    mfaEnabled: user.mfaEnabled,
    mfaMethod: user.mfaMethod,
  };
}

/** Only the authenticated subject's settings endpoints return these fields. */
export function toOwnProfileDto(user: User) {
  return {
    ...toPublicUserDto(user),
    birthday: user.birthday,
    birthdayHideYear: user.birthdayHideYear,
    gender: user.gender,
    phoneNumberMobile: user.phoneNumberMobile,
    phoneNumberWork: user.phoneNumberWork,
    phoneNumberHome: user.phoneNumberHome,
    address: user.address,
    occupation: user.occupation,
    occupationCustom: user.occupationCustom,
    company: user.company,
    socialLinks: user.socialLinks,
    nrc: nrcFromStorage(user.nrc),
    annualIncome: user.annualIncome,
    incomeFrequency: user.incomeFrequency,
    employmentStatus: user.employmentStatus,
    investmentGoal: user.investmentGoal,
    riskTolerance: user.riskTolerance,
    profileCompleteness: user.profileCompleteness,
    updatedAt: user.updatedAt,
  };
}
