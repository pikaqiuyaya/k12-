export type Sub2ApiAuthenticator = (url: string, email: string, password: string) => Promise<void>;

export interface Sub2ApiPasswordPatchValidation {
  currentPassword: string;
  nextPassword: string;
  nextUrl: string;
  nextEmail: string;
  authenticate: Sub2ApiAuthenticator;
}

export async function validateSub2ApiPasswordPatch(input: Sub2ApiPasswordPatchValidation): Promise<void> {
  const nextPassword = input.nextPassword.trim();
  if (!nextPassword || nextPassword === input.currentPassword) return;
  if (!input.nextUrl.trim() || !input.nextEmail.trim()) {
    throw new Error("Sub2API 密码变更前需要先填写地址和账号");
  }

  try {
    await input.authenticate(input.nextUrl, input.nextEmail, nextPassword);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Sub2API 密码验证失败，已保留原密码：${message}`);
  }
}
