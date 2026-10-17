/**
 * Lets the Node-run check scripts import the app's extensionless TypeScript
 * specifiers ('./dates'), which Metro resolves but Node's ESM loader does not.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    throw err;
  }
}
