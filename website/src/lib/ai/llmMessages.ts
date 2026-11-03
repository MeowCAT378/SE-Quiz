import * as m from '$lib/paraglide/messages.js';

export function llmErrorMessage(code: string): string {
	switch (code) {
		case 'configuration_conflict':
			return m.llm_conflict();
		case 'credential_unavailable':
		case 'credential_required':
		case 'credential_destination_changed':
			return m.llm_credentials_error();
		case 'destination_not_allowed':
			return m.llm_destination_error();
		case 'authentication_failed':
		case 'authentication_required':
		case 'administrator_required':
			return m.llm_authentication_error();
		case 'model_unavailable':
			return m.llm_model_error();
		case 'unsupported_option':
			return m.llm_capability_error();
		case 'rate_limited':
			return m.llm_rate_error();
		case 'provider_error':
		case 'provider_unavailable':
			return m.llm_connection_error();
		case 'request_timeout':
			return m.llm_request_timeout_error();
		case 'generation_timeout':
			return m.llm_overall_timeout_error();
		case 'cancelled':
			return m.llm_cancelled();
		case 'invalid_response':
		case 'truncated_response':
		case 'empty_response':
		case 'unexpected_tool_call':
			return m.llm_output_error();
		case 'ai_busy':
			return m.ai_busy();
		case 'ai_unavailable':
		case 'configuration_unavailable':
			return m.llm_unavailable();
		default:
			return m.llm_validation_error();
	}
}
