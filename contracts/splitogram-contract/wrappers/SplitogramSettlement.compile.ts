import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/SplitogramSettlement.tact',
    options: {
        debug: true,
    },
};
