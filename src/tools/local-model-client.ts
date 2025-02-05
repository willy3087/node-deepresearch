import { fetch } from 'undici';

export class LocalModelClient {
  endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  getGenerativeModel(options: { model: string, generationConfig: any }) {
    return {
      generateContent: async (prompt: string) => {
        const payload = {
          prompt,
          model: options.model,
          temperature: options.generationConfig.temperature
          // Você pode incluir outros parâmetros de generationConfig se necessário
        };
        
        const response = await fetch(this.endpoint + '/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data: any = await response.json();

        // Retorna um objeto com a propriedade 'response' que imita a interface esperada
        return {
          response: {
            text: () => JSON.stringify(data),
            usageMetadata: data.usageMetadata || { totalTokenCount: 0 }
          }
        };
      }
    };
  }
} 