/**
 * This file contains secure alternatives to the vulnerable functions in insecure-example.ts
 * These implementations demonstrate proper security practices.
 */

import { Logger } from './logger';

/**
 * Secure function that safely handles user input without execution
 * Uses a predefined list of allowed operations instead of eval
 */
export function processUserInput(input: string, logger: Logger): unknown {
  // Define allowed operations with type-safe implementations
  const allowedOperations: Record<string, (...args: number[]) => number> = {
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => (b !== 0 ? a / b : NaN),
  };
  
  try {
    // Parse input as JSON to get structured data
    const command = JSON.parse(input) as { operation: string; args: number[] };
    
    // Check if operation is allowed
    if (command.operation in allowedOperations) {
      const result = allowedOperations[command.operation](...command.args);
      logger.info(`Processed command ${command.operation} with result: ${result}`);
      return result;
    } else {
      logger.warn(`Unsupported operation requested: ${command.operation}`);
      return null;
    }
  } catch (error) {
    logger.error(`Error processing user input: ${error}`);
    return null;
  }
}

/**
 * Function with secure regular expression
 * Prevents ReDoS by using a safe pattern
 */
export function validateInputSafely(input: string): boolean {
  // Simple fixed-length pattern without catastrophic backtracking
  const safeRegex = /^[a-z]{1,100}$/;
  return safeRegex.test(input);
}

/**
 * Secure credentials validation function
 * Uses environment variables and secure comparison
 */
export function validateCredentialsSecurely(
  username: string, 
  password: string,
  getEnvVar: (name: string) => string | undefined = (name) => process.env[name]
): boolean {
  // Get credentials from environment variables
  const expectedUsername = getEnvVar('ADMIN_USERNAME');
  const expectedPasswordHash = getEnvVar('ADMIN_PASSWORD_HASH');
  
  if (!expectedUsername || !expectedPasswordHash) {
    // Fail securely when configuration is missing
    return false;
  }
  
  // In a real implementation, you would use a proper password hashing library
  // and perform a constant-time comparison of hashed values
  const inputHash = hashPassword(password);
  
  return username === expectedUsername && inputHash === expectedPasswordHash;
}

// Placeholder for a proper password hashing function
function hashPassword(password: string): string {
  // This is a placeholder - in a real application, use a proper crypto library
  // like bcrypt, argon2, or scrypt with salting and proper work factors
  return `hashed_${password}`;
}

/**
 * Secure SQL query construction using parameterization
 */
export function queryUserDataSecurely(userId: string): {
  query: string;
  params: unknown[];
} {
  // Use parameterized query to prevent SQL injection
  const query = 'SELECT * FROM users WHERE id = ?';
  const params = [userId];
  
  return { query, params };
}