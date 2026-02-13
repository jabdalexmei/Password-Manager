export type PasswordGeneratorOptions = {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeSimilar: boolean;
};

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>/?';
const SIMILAR = /[O0I1l]/g;

const buildCharset = (options: PasswordGeneratorOptions) => {
  let charset = '';

  if (options.lowercase) charset += LOWERCASE;
  if (options.uppercase) charset += UPPERCASE;
  if (options.numbers) charset += NUMBERS;
  if (options.symbols) charset += SYMBOLS;

  if (options.excludeSimilar) {
    charset = charset.replace(SIMILAR, '');
  }

  return charset;
};

const getRandomInt = (max: number) => {
  if (max <= 0) return 0;
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);

  while (true) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value < limit) {
      return value % max;
    }
  }
};

export const generatePassword = (options: PasswordGeneratorOptions) => {
  const charset = buildCharset(options);
  if (!charset) return { password: '', charsetSize: 0 };

  let password = '';
  for (let i = 0; i < options.length; i += 1) {
    const index = getRandomInt(charset.length);
    password += charset[index] ?? '';
  }

  return { password, charsetSize: charset.length };
};

export const calculateStrengthBits = (length: number, charsetSize: number) => {
  if (length <= 0 || charsetSize <= 0) return 0;
  return Math.round(length * Math.log2(charsetSize));
};
