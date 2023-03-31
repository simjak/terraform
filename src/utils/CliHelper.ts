export class CliHelper {
    public static getArgValue(argName: string): string {
        for (const arg of process.argv) {
            const argParts = arg.split('=')

            if (argParts.length === 2) {
                if (argParts[0] === argName) {
                    return argParts[1]
                }
            }
        }

        return ''
    }
}
