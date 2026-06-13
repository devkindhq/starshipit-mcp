import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../constants.js';

function getApiKey(): string {
  const key = process.env.STARSHIPIT_API_KEY;
  if (!key) throw new Error('STARSHIPIT_API_KEY environment variable is not set');
  return key;
}

function getSubscriptionKey(): string {
  const key = process.env.STARSHIPIT_SUBSCRIPTION_KEY;
  if (!key) throw new Error('STARSHIPIT_SUBSCRIPTION_KEY environment variable is not set');
  return key;
}

export async function apiRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  data?: unknown,
  params?: Record<string, unknown>
): Promise<T> {
  const config: AxiosRequestConfig = {
    method,
    url: `${API_BASE_URL}/${endpoint}`,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'StarShipIT-Api-Key': getApiKey(),
      'Ocp-Apim-Subscription-Key': getSubscriptionKey(),
    },
    timeout: 30000,
  };

  if (data !== undefined) config.data = data;
  if (params !== undefined) {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') filtered[k] = v;
    }
    config.params = filtered;
  }

  const response = await axios(config);
  return response.data as T;
}

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const status = error.response.status;
      const body = error.response.data as Record<string, unknown> | undefined;
      const detail =
        typeof body?.message === 'string'
          ? `: ${body.message}`
          : typeof body?.errors === 'object'
            ? `: ${JSON.stringify(body.errors)}`
            : '';
      switch (status) {
        case 400:
          return `Error: Bad request${detail}. Check all required fields are provided and valid.`;
        case 401:
          return 'Error: Unauthorized. Check STARSHIPIT_API_KEY and STARSHIPIT_SUBSCRIPTION_KEY are set correctly.';
        case 403:
          return `Error: Forbidden${detail}. You don't have permission to perform this action.`;
        case 404:
          return `Error: Not found${detail}. Check the ID or reference is correct.`;
        case 409:
          return `Error: Conflict${detail}. The resource may already exist or be in an incompatible state.`;
        case 422:
          return `Error: Unprocessable entity${detail}. Validate the request body schema.`;
        case 429:
          return 'Error: Rate limit exceeded. Wait before making more requests.';
        case 500:
          return `Error: StarShipIt server error${detail}. Try again later.`;
        default:
          return `Error: API request failed with status ${status}${detail}.`;
      }
    }
    if (error.code === 'ECONNABORTED') {
      return 'Error: Request timed out. The StarShipIt API may be slow — try again.';
    }
    if (error.code === 'ECONNREFUSED') {
      return 'Error: Connection refused. Check network connectivity.';
    }
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
