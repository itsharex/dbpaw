export const FAQS = [
  {
    question: 'Which databases are currently supported?',
    answer:
      'DbPaw currently supports PostgreSQL, MySQL, SQLite, and ClickHouse (Preview, Read-only), with more drivers planned in future updates.'
  },
  {
    question: 'Does DbPaw work with remote databases?',
    answer:
      'Yes. DbPaw supports SSH tunneling so you can connect securely to remote database instances.'
  },
  {
    question: 'How does AI assistance work?',
    answer:
      'You can use the AI sidebar to generate SQL, explain queries, and optimize statements based on your intent.'
  },
  {
    question: 'Is DbPaw open source?',
    answer: 'Yes. DbPaw is released under the MIT License on GitHub.'
  },
  {
    question: 'I see a macOS security warning. What should I do?',
    answer:
      'Move DbPaw.app to /Applications and remove quarantine attributes using the command shown on the download page.'
  }
] as const;
