import net from 'node:net';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface SocksFixture {
  port: number;
  connections: Array<{ host: string; port: number }>;
  close: () => Promise<void>;
}

export interface OriginFixture {
  port: number;
  requests: string[];
  close: () => Promise<void>;
}

/**
 * Minimal SOCKS5 server (no auth, CONNECT only). Every hostname is resolved to
 * 127.0.0.1 on purpose so tests can prove that the browser sent the hostname to
 * the proxy (remote DNS) and that traffic traversed it.
 */
export async function startSocks5Server(): Promise<SocksFixture> {
  const connections: Array<{ host: string; port: number }> = [];
  const server = net.createServer((socket) => {
    socket.once('data', (greeting) => {
      if (greeting.length < 2 || greeting[0] !== 0x05) {
        socket.destroy();
        return;
      }
      socket.write(Buffer.from([0x05, 0x00]));
      socket.once('data', (request) => {
        if (request.length < 7 || request[0] !== 0x05 || request[1] !== 0x01) {
          socket.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return;
        }
        const atyp = request[3];
        let host = '';
        let offset = 4;
        if (atyp === 0x01) {
          host = `${request[4]}.${request[5]}.${request[6]}.${request[7]}`;
          offset = 8;
        } else if (atyp === 0x03) {
          const length = request[4] ?? 0;
          host = request.subarray(5, 5 + length).toString('utf8');
          offset = 5 + length;
        } else if (atyp === 0x04) {
          const parts: string[] = [];
          for (let index = 0; index < 16; index += 2) {
            parts.push(((request[4 + index] ?? 0) << 8 | (request[5 + index] ?? 0)).toString(16));
          }
          host = parts.join(':');
          offset = 4 + 16;
        } else {
          socket.destroy();
          return;
        }
        const port = request.readUInt16BE(offset);
        connections.push({ host, port });
        const upstream = net.connect({ host: '127.0.0.1', port }, () => {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x7f, 0x00, 0x00, 0x01, 0x00, 0x00]));
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on('error', () => {
          socket.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        });
        socket.on('error', () => upstream.destroy());
      });
    });
    socket.on('error', () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    connections,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export async function startOriginServer(): Promise<OriginFixture> {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method ?? 'GET'} ${request.headers.host ?? 'unknown'}${request.url ?? '/'}`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end('<!doctype html><html><body><h1 id="marker">PROXY E2E OK</h1></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
