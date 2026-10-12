-- Add custom OpenAI endpoint configuration fields
-- Enables Ollama, LiteLLM, OpenRouter, and other OpenAI-compatible providers

ALTER TABLE `ai_settings` ADD COLUMN `openai_base_url` TEXT NULL;
ALTER TABLE `ai_settings` ADD COLUMN `openai_model` VARCHAR(100) NULL;
