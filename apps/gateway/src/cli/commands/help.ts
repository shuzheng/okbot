import type { CliMessages } from '../i18n';
import { readGatewayVersion } from '../version';

export function printGlobalHelp(t: CliMessages): void {
  console.log(t.usageTitle);
  console.log('');
  console.log(t.usageCommands);
  console.log(`  help       ${t.cmdHelp}`);
  console.log(`  version    ${t.cmdVersion}`);
  console.log(`  serve      ${t.cmdServe}`);
  console.log(`  status     ${t.cmdStatus}`);
  console.log(`  stop       ${t.cmdStop}`);
  console.log(`  restart    ${t.cmdRestart}`);
  console.log(`  config     ${t.cmdConfig}`);
  console.log(`  token      ${t.cmdToken}`);
  console.log(`  data       ${t.cmdData}`);
  console.log('');
  console.log(t.helpHint);
}

export function printVersion(t: CliMessages): number {
  const v = readGatewayVersion();
  if (!v) {
    console.error(t.versionMissing);
    return 1;
  }
  console.log(t.versionLabel(v));
  return 0;
}

export function printCommandHelp(command: string, t: CliMessages): void {
  switch (command) {
    case 'serve':
      console.log(t.serveHelp);
      break;
    case 'status':
      console.log(t.statusHelp);
      break;
    case 'stop':
      console.log(t.stopHelp);
      break;
    case 'restart':
      console.log(t.restartHelp);
      break;
    case 'config':
      console.log(t.configHelp);
      break;
    case 'token':
      console.log(t.tokenHelp);
      break;
    case 'data':
      console.log(t.dataHelp);
      break;
    case 'help':
    case 'version':
    default:
      printGlobalHelp(t);
      break;
  }
}
