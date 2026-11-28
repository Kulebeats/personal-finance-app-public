/**
 * AH-03 / R20.3: the local SMTP sink of the production-mode browser profile.
 *
 * A minimal in-process SMTP server on loopback. The app sends through its real
 * mail path (services/emailService.ts, nodemailer over SMTP) and the sink keeps
 * each accepted message in memory, so a browser spec can read the mail it was
 * sent and follow the link in it. Nothing leaves the process: the browser
 * server's network guard admits a socket only to an endpoint this process
 * listens on. No dependency and no TLS: STARTTLS is not offered, any AUTH
 * PLAIN or LOGIN is accepted, and messages are never relayed.
 */
import net from "node:net";

export interface CapturedMail {
  from: string;
  to: string[];
  /** The DATA section as sent (headers and MIME body), dot-unstuffed. */
  raw: string;
}

export interface SmtpSink {
  port: number;
  messages(): readonly CapturedMail[];
  close(): Promise<void>;
}

const HOST = "127.0.0.1";
const NAME = "pfa-test-sink";
/** Generous for the app's own mail; refuses anything runaway. */
const MAX_MESSAGE_BYTES = 1_000_000;

type Phase = "command" | "data" | "auth-plain" | "auth-login-user" | "auth-login-pass";

interface Envelope { from: string; to: string[] }

const addressOf = (argument: string): string => /<([^>]*)>/.exec(argument)?.[1] ?? argument.trim();

function handleConnection(socket: net.Socket, store: (mail: CapturedMail) => void): void {
  let phase: Phase = "command";
  let buffer = "";
  let envelope: Envelope = { from: "", to: [] };
  let data: string[] = [];
  let dataBytes = 0;
  const reply = (line: string) => socket.write(`${line}\r\n`);

  const onCommand = (line: string) => {
    const [verb = "", ...rest] = line.split(" ");
    const argument = rest.join(" ");
    switch (verb.toUpperCase()) {
      case "EHLO": return reply(`250-${NAME}\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME`);
      case "HELO": return reply(`250 ${NAME}`);
      case "AUTH": {
        const [method = "", initial] = argument.split(" ");
        if (method.toUpperCase() === "PLAIN") {
          if (initial) return reply("235 2.7.0 Accepted");
          phase = "auth-plain";
          return reply("334 ");
        }
        if (method.toUpperCase() === "LOGIN") { phase = "auth-login-user"; return reply("334 VXNlcm5hbWU6"); }
        return reply("504 5.5.4 Unrecognised authentication type");
      }
      case "MAIL": envelope = { from: addressOf(argument), to: [] }; return reply("250 2.1.0 OK");
      case "RCPT": envelope = { ...envelope, to: [...envelope.to, addressOf(argument)] }; return reply("250 2.1.5 OK");
      case "DATA":
        if (envelope.to.length === 0) return reply("503 5.5.1 No recipients");
        phase = "data"; data = []; dataBytes = 0;
        return reply("354 End data with <CR><LF>.<CR><LF>");
      case "RSET": envelope = { from: "", to: [] }; return reply("250 2.0.0 OK");
      case "NOOP": return reply("250 2.0.0 OK");
      case "QUIT": reply("221 2.0.0 Bye"); socket.end(); return undefined;
      default: return reply("502 5.5.2 Command not implemented");
    }
  };

  const onLine = (line: string) => {
    if (phase === "data") {
      if (line === ".") {
        store({ ...envelope, raw: data.join("\r\n") });
        envelope = { from: "", to: [] };
        phase = "command";
        return reply("250 2.0.0 Queued in the test sink");
      }
      dataBytes += line.length + 2;
      if (dataBytes > MAX_MESSAGE_BYTES) { reply("552 5.3.4 Message too big"); socket.destroy(); return undefined; }
      data.push(line.startsWith("..") ? line.slice(1) : line);
      return undefined;
    }
    if (phase === "auth-plain" || phase === "auth-login-pass") { phase = "command"; return reply("235 2.7.0 Accepted"); }
    if (phase === "auth-login-user") { phase = "auth-login-pass"; return reply("334 UGFzc3dvcmQ6"); }
    return onCommand(line);
  };

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf("\r\n");
    while (end !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      onLine(line);
      end = buffer.indexOf("\r\n");
    }
  });
  socket.on("error", () => socket.destroy());
  reply(`220 ${NAME} ESMTP`);
}

/** Starts the sink on an ephemeral loopback port. */
export async function startSmtpSink(): Promise<SmtpSink> {
  let captured: readonly CapturedMail[] = [];
  const server = net.createServer((socket) => handleConnection(socket, (mail) => { captured = [...captured, mail]; }));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The SMTP sink did not bind a TCP port");
  return {
    port: address.port,
    messages: () => captured,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
