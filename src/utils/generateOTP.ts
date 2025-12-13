/**
 * Generate a random 6-digit OTP
 * For testing: Returns hardcoded "123456"
 */
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Generate OTP expiration time (default: 10 minutes)
 */
export const getOTPExpiration = (minutes: number = 10): Date => {
  const expiration = new Date();
  expiration.setMinutes(expiration.getMinutes() + minutes);
  return expiration;
};

