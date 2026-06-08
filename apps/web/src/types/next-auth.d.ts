import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
    };
    // Versão da credencial gravada no login, comparada com o banco. (auditoria #13)
    credentialVersion?: number;
  }

  interface User {
    credentialVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    credentialVersion?: number;
  }
}
