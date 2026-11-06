import { describe, expect, test } from 'bun:test';
import { sections } from '@/components/app-shell';
import { routeAt, routeTemplate, sessionPages } from '@/lib/routes';

function at(pathname: string) {
  return { pathname, search: '?q=得宝', hash: '#top' };
}

describe('route templates', () => {
  test.each([
    ['/', '/'],
    ['/products', '/products'],
    ['/categories', '/categories'],
    ['/recognitions', '/recognitions'],
    ['/channels', '/channels'],
    ['/promotions', '/promotions'],
    ['/members', '/members'],
    ['/invitations', '/invitations'],
    ['/households', '/households'],
    ['/settings', '/settings'],
    ['/sign-up', '/sign-up'],
    ['/reset-password', '/reset-password'],
    ['/oauth/sign-in', '/oauth/sign-in'],
    ['/oauth/consent', '/oauth/consent'],
    ['/products/0193-abcd', '/products/:id'],
    ['/products/%E0', '/products/:id'],
    ['/recognitions/0193-abcd', '/recognitions/:id'],
    ['/join/0193-abcd', '/join/:id'],
    ['/products/0193/extra', '/unknown'],
    ['/products/', '/unknown'],
    ['/settings/', '/unknown'],
    ['/join', '/unknown'],
    ['/someone@example.com', '/unknown'],
  ])('%s is reported as %s', (pathname, template) => {
    expect(routeTemplate(at(pathname))).toBe(template);
  });

  test('every section and every page outside the shell is reported by its own path', () => {
    for (const { path } of sections) expect(routeTemplate(at(path))).toBe(path);
    for (const path of Object.values(sessionPages)) expect(routeTemplate(at(path))).toBe(path);
  });
});

describe('the page at a path', () => {
  test('a product or recognition page carries its decoded id in its section', () => {
    expect(routeAt('/products/a%20b')).toEqual({ section: '/products', productId: 'a b' });
    expect(routeAt('/recognitions/0193-abcd')).toEqual({ section: '/recognitions', recognitionId: '0193-abcd' });
  });

  test('a section is its own page, and any other path has none', () => {
    expect(routeAt('/channels')).toEqual({ section: '/channels' });
    expect(routeAt('/sign-up')).toBeUndefined();
    expect(routeAt('/products/0193/extra')).toBeUndefined();
  });
});
