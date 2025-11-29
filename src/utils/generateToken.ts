import jwt from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;
  email?: string;
}

export const generateToken = (payload: TokenPayload): string => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRE || '7d';

  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }

  // Type assertion to handle StringValue type from jsonwebtoken
  return jwt.sign(payload, secret, {
    expiresIn: expiresIn as any
  });
};

export const verifyToken = (token: string): TokenPayload => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }

  return jwt.verify(token, secret) as TokenPayload;
};

