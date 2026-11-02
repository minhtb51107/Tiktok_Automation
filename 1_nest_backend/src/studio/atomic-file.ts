import { promises as fs } from 'fs';

// Windows readers/antivirus can briefly lock the destination of an atomic rename.
// Keep the existing file intact and retry only transient sharing violations.
export async function replaceFile(temp: string, destination: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(temp, destination);
      return;
    } catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}
