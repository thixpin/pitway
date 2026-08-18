import { parse, stringify } from 'yaml';
import { contractFrontmatterSchema, type ContractFrontmatter } from './schemas.js';
import type { ZodError } from 'zod';

export interface ContractFile {
  frontmatter: ContractFrontmatter;
  body: string;
}

export class ContractFileError extends Error {}

const OPEN_DELIMITER = '---\n';
const CLOSE_DELIMITER = '\n---\n';

export function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export function parseContractFile(text: string): ContractFile {
  if (!text.startsWith(OPEN_DELIMITER)) {
    throw new ContractFileError('contract is missing its opening frontmatter delimiter (---)');
  }
  const closeAt = text.indexOf(CLOSE_DELIMITER, OPEN_DELIMITER.length - 1);
  if (closeAt === -1) {
    throw new ContractFileError('contract is missing its closing frontmatter delimiter (---)');
  }

  const yamlText = text.slice(OPEN_DELIMITER.length, closeAt + 1);
  // The body is everything after the closing delimiter, preserved verbatim.
  const body = text.slice(closeAt + CLOSE_DELIMITER.length);

  let data: unknown;
  try {
    data = parse(yamlText);
  } catch (error) {
    throw new ContractFileError(
      `contract frontmatter is not valid YAML: ${(error as Error).message}`,
    );
  }

  const result = contractFrontmatterSchema.safeParse(data);
  if (!result.success) {
    throw new ContractFileError(`invalid contract frontmatter: ${formatIssues(result.error)}`);
  }

  return { frontmatter: result.data, body };
}

export function serializeContractFile(contract: ContractFile): string {
  const result = contractFrontmatterSchema.safeParse(contract.frontmatter);
  if (!result.success) {
    throw new ContractFileError(`invalid contract frontmatter: ${formatIssues(result.error)}`);
  }
  return `${OPEN_DELIMITER}${stringify(result.data)}${OPEN_DELIMITER}${contract.body}`;
}
