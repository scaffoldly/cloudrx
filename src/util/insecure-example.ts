/**
 * This file contains intentionally insecure code to trigger CodeQL alerts.
 * DO NOT USE IN PRODUCTION!
 */

import { Logger } from './logger';

/**
 * Insecure function that executes code from user input
 * This is intentionally vulnerable to command injection
 */
export function executeUserInput(input: string, logger: Logger): void {
  // SECURITY ISSUE: Using eval on user input is extremely dangerous
  try {
    // eslint-disable-next-line no-eval
    const result = eval(input);
    logger.info(`Executed user input with result: ${result}`);
  } catch (error) {
    logger.error(`Error executing user input: ${error}`);
  }
}

/**
 * Function with insecure regular expression
 * Vulnerable to ReDoS (Regular Expression Denial of Service)
 */
export function validateInput(input: string): boolean {
  // SECURITY ISSUE: This regex has catastrophic backtracking issues
  const insecureRegex = /^(a+)+$/;
  return insecureRegex.test(input);
}

/**
 * Insecure password validation function
 * Contains hardcoded credentials
 */
export function validateCredentials(username: string, password: string): boolean {
  // SECURITY ISSUE: Hardcoded credentials
  const adminPassword = 'admin123!';
  
  if (username === 'admin' && password === adminPassword) {
    return true;
  }
  
  return false;
}

/**
 * Insecure SQL query construction
 * Vulnerable to SQL injection
 */
export function queryUserData(userId: string): string {
  // SECURITY ISSUE: String concatenation for SQL queries
  const query = `SELECT * FROM users WHERE id = ${userId}`;
  return query;
}