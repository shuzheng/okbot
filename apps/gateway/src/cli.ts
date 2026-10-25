import { detectLocale, messagesFor } from './cli/i18n';
import { isKnownCommand, parseArgv } from './cli/parse';
import { printCommandHelp, printGlobalHelp, printVersion } from './cli/commands/help';
import { serve } from './cli/commands/serve';
import { status } from './cli/commands/status';
import { stop } from './cli/commands/stop';
import { restart } from './cli/commands/restart';
import { configCommand } from './cli/commands/config';
import { tokenCommand } from './cli/commands/token';
import { dataCommand } from './cli/commands/data';

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv);
  const locale = detectLocale(process.env, parsed.lang);
  const t = messagesFor(locale);

  if (parsed.error === 'invalid_lang') {
    console.error(t.invalidLang);
    return 1;
  }

  // Global --version / -V with no other command
  if (parsed.version && (!parsed.command || parsed.command === 'version')) {
    return printVersion(t);
  }

  // Bare invocation, `help`, or global --help without a command
  if (!parsed.command || parsed.command === 'help') {
    printGlobalHelp(t);
    return 0;
  }

  if (!isKnownCommand(parsed.command)) {
    console.error(t.unknownCommand(parsed.command));
    printGlobalHelp(t);
    return 1;
  }

  // `okbot <cmd> --help`
  if (parsed.help) {
    printCommandHelp(parsed.command, t);
    return 0;
  }

  if (parsed.command === 'version') {
    return printVersion(t);
  }

  switch (parsed.command) {
    case 'serve':
      return serve(t, parsed.args);
    case 'status':
      return status(t, parsed.args);
    case 'stop':
      return stop(t, { args: parsed.args });
    case 'restart':
      return restart(t, parsed.args);
    case 'config':
      return configCommand(parsed.args, t);
    case 'token':
      return tokenCommand(parsed.args, t);
    case 'data':
      return dataCommand(parsed.args, t);
    default:
      console.error(t.unknownCommand(parsed.command));
      printGlobalHelp(t);
      return 1;
  }
}

void main(process.argv.slice(2)).then((code) => {
  if (code !== 0) process.exit(code);
});
