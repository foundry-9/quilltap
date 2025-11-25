export const GoogleGenerativeAI = jest.fn().mockImplementation(() => ({
  getGenerativeModel: jest.fn().mockReturnValue({
    generateContent: jest.fn(),
    generateContentStream: jest.fn(),
    countTokens: jest.fn(),
  }),
}));

export const HarmCategory = {
  HARM_CATEGORY_UNSPECIFIED: 'HARM_CATEGORY_UNSPECIFIED',
  HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
  HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
  HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
};

export const HarmBlockThreshold = {
  BLOCK_NONE: 'BLOCK_NONE',
  BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
  BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
  BLOCK_LOW_AND_ABOVE: 'BLOCK_LOW_AND_ABOVE',
};