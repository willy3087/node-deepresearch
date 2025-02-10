import { fetch } from 'undici';

interface ModelResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: string;
  usage?: {
    totalTokenCount: number;
  };
}

function normalizeAction(action: string): string {
  // Remove prefixos/sufixos comuns e normaliza a ação
  const normalized = action.toLowerCase()
    .replace(/^action[-_]?/, '')  // remove 'action-' ou 'action_' do início
    .replace(/[-_]?action$/, '')  // remove '-action' ou '_action' do fim
    .replace(/^query[-_]?/, '')   // remove 'query-' ou 'query_' do início
    .replace(/[-_]?query$/, '');  // remove '-query' ou '_query' do fim

  // Mapeamento de ações conhecidas
  const actionMap: { [key: string]: string } = {
    'search': 'search',
    'answer': 'answer',
    'reflect': 'reflect',
    'visit': 'visit'
  };

  return actionMap[normalized] || action;
}

function normalizeSearchQuery(content: any): any {
  // Se a ação for search e não tiver searchQuery mas tiver query
  if (content.action === 'search' && !content.searchQuery && content.query) {
    content.searchQuery = content.query;
    delete content.query;
  }
  return content;
}

function extractLastJSON(text: string): string {
  // Encontra todos os possíveis JSONs no texto
  const matches = text.match(/\{(?:[^{}]|{[^{}]*})*\}/g);
  
  if (!matches) {
    throw new Error('Nenhum JSON válido encontrado na resposta');
  }

  // Pega o último JSON encontrado (geralmente é a resposta final após o raciocínio)
  const lastJson = matches[matches.length - 1];
  
  try {
    // Verifica se é um JSON válido
    JSON.parse(lastJson);
    return lastJson;
  } catch (e) {
    throw new Error('JSON encontrado não é válido');
  }
}

export class LocalModelClient {
  endpoint: string;
  private generateContentMethod: (prompt: string) => Promise<any>;

  constructor(endpoint: string) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.generateContentMethod = async () => {
      throw new Error('generateContent não foi inicializado ainda');
    };
  }

  async retryWithCorrection(prompt: string, error: string): Promise<string> {
    const correctionPrompt = `
Houve um erro no seu último formato de resposta: "${error}"

Por favor, corrija sua resposta seguindo EXATAMENTE este formato:

Para ação de busca:
{
  "action": "search",
  "think": "Seu raciocínio aqui",
  "searchQuery": "sua query de busca aqui"
}

Para ação de resposta:
{
  "action": "answer",
  "think": "Seu raciocínio aqui",
  "answer": "sua resposta aqui",
  "references": [{"exactQuote": "citação", "url": "fonte"}]
}

Para ação de reflexão:
{
  "action": "reflect",
  "think": "Seu raciocínio aqui",
  "questionsToAnswer": ["pergunta 1", "pergunta 2", "pergunta 3", "pergunta 4", "pergunta 5"]
}

Agora corrija sua resposta anterior mantendo a mesma intenção mas usando o formato correto:

${prompt}`;

    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-7b-instruct-1m",
        messages: [
          { 
            role: "system", 
            content: "Você deve corrigir o formato da resposta anterior mantendo a mesma intenção."
          },
          { 
            role: "user", 
            content: correctionPrompt 
          }
        ],
        temperature: 0.7,
        max_tokens: -1,
        stream: false
      })
    });

    const data = await response.json() as ModelResponse;
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Resposta inválida do modelo na correção');
    }

    return data.choices[0].message.content;
  }

  getGenerativeModel(options: { model: string, generationConfig: any }) {
    this.generateContentMethod = async (prompt: string) => {
      const payload = {
        model: options.model,
        messages: [
          { 
            role: "system", 
            content: `Você é um buscador curioso e muito experiênte, consegue achar qualquer coisa na internet, procura até nos mínimos detalhes de pistas que possam te levar até a resposta correta. Suas respostas devem seguir estas regras:
              1. Use sempre português do Brasil nas respostas finais
              2. Mantenha o formato JSON conforme solicitado
              3. Não inclua tags XML como <think> no JSON final
              4. Se precisar explicar seu raciocínio, faça isso em português antes de dar a resposta em JSON

              5. EXERCÍCIO DE RACIOCÍNIO OBRIGATÓRIO em caso de perguntas que envolvam o assunto de classificão fiscal no brasil:
                Quando encontrar variações (por estado, regime, etc), você DEVE:
                a) Primeiro listar TODAS as variáveis envolvidas
                    Exemplo: "Temos 3 estados × 2 regimes × 2 tipos de operação = 12 possibilidades"
                
                b) Criar uma matriz de possibilidades
                    Exemplo: "Vamos analisar cada combinação:
                    - SP + Simples + Entrada
                    - SP + Simples + Saída
                    - SP + Normal + Entrada
                    [etc]"
                
                c) Buscar informação específica para CADA caso
                    - Não pule nenhuma combinação
                    - Cite a fonte/legislação para cada caso
                    - Dê exemplos práticos

              6. ESTRUTURA DA RESPOSTA:
                a) Primeiro explique as variáveis:
                    "Para determinar o CST correto, precisamos considerar:
                    1. Estado: SP, SC ou CE
                    2. Regime: Simples ou Normal
                    3. Operação: Entrada ou Saída"
                
                b) Mostre a matriz de possibilidades:
                    "Isso nos dá 12 combinações possíveis (3×2×2)"
                
                c) Liste CADA possibilidade com:
                    - Código específico
                    - Base legal
                    - Exemplo prático
                    - Observações relevantes

              7. FORMATO JSON OBRIGATÓRIO:

              Para ação de busca:
              {
                "action": "search",
                "think": "Seu raciocínio aqui",
                "searchQuery": "sua query de busca aqui"
              }

              Para ação de resposta:
              {
                "action": "answer",
                "think": "Seu raciocínio aqui",
                "answer": "sua resposta aqui",
                "references": [{"exactQuote": "citação", "url": "fonte"}]
              }

              Para ação de reflexão:
              {
                "action": "reflect",
                "think": "Seu raciocínio aqui",
                "questionsToAnswer": ["pergunta 1", "pergunta 2", "pergunta 3", "pergunta 4", "pergunta 5"]
              }

              8. IMPORTANTE:
                - Use EXATAMENTE os nomes dos campos mostrados acima
                - Para busca, use sempre "searchQuery" (não use "query")
                - Inclua sempre o campo "think" explicando seu raciocínio
                - Mantenha a estrutura exata do JSON
                - NUNCA diga apenas "depende" ou "consulte um profissional"
                - SEMPRE mostre todas as possibilidades
                - SEMPRE dê exemplos práticos
                - SEMPRE cite a legislação`
          },
          { 
            role: "user", 
            content: prompt 
          }
        ],
        temperature: options.generationConfig.temperature,
        max_tokens: -1,
        stream: false
      };

      const fullEndpoint = `${this.endpoint}/v1/chat/completions`.replace(/\/+/g, '/');
      console.log('Endpoint completo:', fullEndpoint);
      
      const response = await fetch(fullEndpoint, {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json() as ModelResponse;

      if (data.error) {
        console.error('\x1b[31m%s\x1b[0m', `Erro na resposta do modelo: ${data.error}`);
        throw new Error(`Erro na resposta do modelo: ${data.error}`);
      }

      if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error('Resposta do modelo não contém conteúdo válido');
      }

      const rawContent = data.choices[0].message.content;
      console.log('Resposta completa do modelo:', rawContent);
      
      try {
        // Extrai o último JSON da resposta (após o raciocínio)
        const jsonContent = extractLastJSON(rawContent);
        let content = JSON.parse(jsonContent);
        
        // Normaliza a ação se necessário
        if (content.action) {
          const normalizedAction = normalizeAction(content.action);
          if (normalizedAction !== content.action) {
            console.log(`Normalizando ação de "${content.action}" para "${normalizedAction}"`);
            content.action = normalizedAction;
          }
        }

        // Normaliza searchQuery se necessário
        content = normalizeSearchQuery(content);
        
        // Validação adicional do formato da ação
        if (!['search', 'answer', 'reflect', 'visit'].includes(content.action)) {
          console.error('Ação inválida detectada mesmo após normalização:', content.action);
          const correctedContent = await this.retryWithCorrection(prompt, 'Ação inválida');
          return this.generateContentMethod(correctedContent);
        }
        
        // Validação adicional dos campos obrigatórios
        if (content.action === 'search' && !content.searchQuery) {
          console.error('Campo searchQuery faltando');
          const correctedContent = await this.retryWithCorrection(prompt, 'Campo searchQuery é obrigatório para ação search');
          return this.generateContentMethod(correctedContent);
        }
        
        if (content.action === 'answer') {
          console.log('\x1b[32m%s\x1b[0m', 'Resposta encontrada! Verificando qualidade...');
        } else if (content.action === 'search') {
          console.log('\x1b[33m%s\x1b[0m', 'Realizando busca com JINA...');
        }

        return {
          response: {
            text: () => JSON.stringify(content),
            usageMetadata: data.usage || { totalTokenCount: 0 }
          }
        };
      } catch (e: unknown) {
        console.error('\x1b[31m%s\x1b[0m', 'Erro ao processar resposta do modelo:', e);
        console.log('Resposta completa do modelo:', rawContent);
        const correctedContent = await this.retryWithCorrection(prompt, (e as Error).message);
        return this.generateContentMethod(correctedContent);
      }
    };

    return {
      generateContent: this.generateContentMethod
    };
  }
}