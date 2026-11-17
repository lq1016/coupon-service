import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../src/security/jwt.js';
import { hashPassword, verifyPassword } from '../src/security/password.js';
import { ERROR_CODES, errorInfo } from '../src/security/errors.js';

describe('JWT', () => {
  it('签发并验证 token', () => {
    const t = signToken({ id: 'u1', username: 'a', role: 'user' });
    const p = verifyToken(t);
    expect(p?.sub).toBe('u1');
    expect(p?.username).toBe('a');
    expect(p?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
  it('篡改 token 返回 null', () => {
    const t = signToken({ id: 'u1', username: 'a', role: 'user' });
    expect(verifyToken(t + 'x')).toBeNull();
    expect(verifyToken('a.b.c')).toBeNull();
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('only.two')).toBeNull();
  });
  it('格式错误的 token 不抛异常', () => {
    const body = Buffer.from(JSON.stringify({ sub: 'u', exp: 1 })).toString('base64url');
    expect(verifyToken(`hdr.${body}.bad`)).toBeNull();
    expect(verifyToken('a.b.c')).toBeNull();
  });
});

describe('密码哈希', () => {
  it('正确密码验证通过，错误密码失败', () => {
    const h = hashPassword('Pass@123');
    expect(verifyPassword('Pass@123', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });
  it('相同密码不同盐', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
  });
  it('非法存储格式返回 false', () => {
    expect(verifyPassword('x', 'bad')).toBe(false);
    expect(verifyPassword('x', 'md5$abc$def')).toBe(false);
    expect(verifyPassword('x', 'scrypt$zz$zz')).toBe(false);
  });
});

describe('错误码表', () => {
  it('不少于 20 个错误码', () => {
    expect(Object.keys(ERROR_CODES).length).toBeGreaterThanOrEqual(20);
  });
  it('errorInfo 返回 status 与 message', () => {
    expect(errorInfo('INSUFFICIENT_STOCK').status).toBe(409);
    expect(errorInfo('UNAUTHORIZED').message).toBeTruthy();
  });
});
