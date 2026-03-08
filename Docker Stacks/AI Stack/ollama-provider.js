// Custom Promptfoo provider for Ollama + Qwen3 tool calling
// Bypasses Promptfoo's bug where it reads Qwen3's 'reasoning' field as content

module.exports = class OllamaToolProvider {
  constructor(options) {
    // Promptfoo passes {id, config, env} to constructor
    // id format: "file:///app/ollama-provider.js:qwen3:8b"
    const idParts = (options.id || '').split(':');
    // Extract model name from the id after the file path
    this.modelName = idParts.length > 3 ? idParts.slice(3).join(':') : 'qwen3:8b';
    this.config = options.config || {};
  }

  id() {
    return `ollama:${this.modelName}`;
  }

  async callApi(prompt, context) {
    let messages;
    try {
      messages = JSON.parse(prompt);
    } catch {
      messages = [{ role: 'user', content: prompt }];
    }

    const body = {
      model: this.modelName,
      messages,
      tools: this.config.tools || [],
      tool_choice: 'auto',
    };

    try {
      const res = await fetch('http://ollama:11434/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer unused',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        return { error: `Ollama HTTP ${res.status}: ${text}` };
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const msg = choice?.message;

      if (!msg) {
        return { error: `No message in response: ${JSON.stringify(data).substring(0, 200)}` };
      }

      const tokenUsage = {
        total: data.usage?.total_tokens || 0,
        prompt: data.usage?.prompt_tokens || 0,
        completion: data.usage?.completion_tokens || 0,
      };

      // If model returned tool_calls, return them as the output (JSON array)
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        return {
          output: msg.tool_calls.map(tc => ({
            id: tc.id,
            type: tc.type,
            function: tc.function,
          })),
          tokenUsage,
        };
      }

      // No tool calls — return text content (ignore reasoning field)
      return {
        output: msg.content || '',
        tokenUsage,
      };
    } catch (err) {
      return { error: `Provider error: ${err.message}` };
    }
  }
};
