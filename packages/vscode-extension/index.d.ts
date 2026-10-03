export interface Variable {
    key: string;
    prompt?: string;
}

export interface FileItem {
    name: string;
    snippet?: string;
    content?: string | string[];
}

export interface Structure {
    files?: FileItem[];
    folders?: FolderItem[];
}

export interface FolderItem extends Structure {
    name: string;
}

export interface Blueprint {
    title: string;
    variables?: Variable[];
    snippets?: Record<string, string | string[]>;
    structure: Structure;
}

export interface BlueprintorConfig {
    blueprints: Blueprint[];
}
