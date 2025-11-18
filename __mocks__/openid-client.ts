export class Issuer {
  static discover(url: string) {
    return Promise.resolve({
      metadata: {},
    })
  }
}

export class Client {
  constructor(metadata: any) {}
}

export function generators(length: number) {
  return 'mock_code_verifier'
}

export { Issuer as default }
