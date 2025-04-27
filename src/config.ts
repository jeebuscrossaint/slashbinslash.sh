export const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
export const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
export const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
export const FILE_EXPIRY_DAYS = 3;
