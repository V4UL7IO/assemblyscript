/**
 * AssemblyScript's intermediate representation describing a program's elements.
 * @module program
 *//***/

import {
  Options
} from "./compiler";

import {
  DiagnosticCode,
  DiagnosticMessage,
  DiagnosticEmitter
} from "./diagnostics";

import {
  Type,
  Signature,

  typesToString
} from "./types";

import {
  Node,
  NodeKind,
  Source,
  Range,
  CommonTypeNode,
  TypeNode,
  TypeParameterNode,
  // ParameterNode,
  // ParameterKind,
  // SignatureNode,
  DecoratorNode,
  DecoratorKind,

  Expression,
  AssertionExpression,
  ElementAccessExpression,
  IdentifierExpression,
  LiteralExpression,
  LiteralKind,
  ParenthesizedExpression,
  PropertyAccessExpression,
  StringLiteralExpression,
  CallExpression,

  ClassDeclaration,
  DeclarationStatement,
  EnumDeclaration,
  EnumValueDeclaration,
  ExportMember,
  ExportStatement,
  FieldDeclaration,
  FunctionDeclaration,
  ImportDeclaration,
  ImportStatement,
  InterfaceDeclaration,
  MethodDeclaration,
  NamespaceDeclaration,
  TypeDeclaration,
  VariableLikeDeclarationStatement,
  VariableStatement,

  ParameterKind,
  SignatureNode,
  VariableDeclaration,
  stringToDecoratorKind
} from "./ast";

import {
  Module,
  NativeType,
  FunctionRef,
} from "./module";

/** Path delimiter inserted between file system levels. */
export const PATH_DELIMITER = "/";
/** Substitution used to indicate the parent directory. */
export const PARENT_SUBST = "..";
/** Function name prefix used for getters. */
export const GETTER_PREFIX = "get:";
/** Function name prefix used for setters. */
export const SETTER_PREFIX = "set:";
/** Delimiter used between class names and instance members. */
export const INSTANCE_DELIMITER = "#";
/** Delimiter used between class and namespace names and static members. */
export const STATIC_DELIMITER = ".";
/** Delimiter used between a function and its inner elements. */
export const INNER_DELIMITER = "~";
/** Substitution used to indicate a library directory. */
export const LIBRARY_SUBST = "~lib";
/** Library directory prefix. */
export const LIBRARY_PREFIX = LIBRARY_SUBST + PATH_DELIMITER;

/** Represents a yet unresolved export. */
class QueuedExport {
  isReExport: bool;
  referencedName: string;
  member: ExportMember;
}

/** Represents a yet unresolved import. */
class QueuedImport {
  internalName: string;
  referencedName: string;
  referencedNameAlt: string;
  declaration: ImportDeclaration;
}

/** Represents a type alias. */
class TypeAlias {
  typeParameters: TypeParameterNode[] | null;
  type: CommonTypeNode;
}

/** Represents the kind of an operator overload. */
export enum OperatorKind {
  INVALID,
  INDEXED_GET,
  INDEXED_SET,
  ADD,
  SUB,
  MUL,
  DIV,
  REM,
  POW,
  AND,
  OR,
  XOR,
  EQ,
  NE,
  GT,
  GE,
  LT,
  LE
}

function operatorKindFromString(str: string): OperatorKind {
  switch (str) {
    case "[]" : return OperatorKind.INDEXED_GET;
    case "[]=": return OperatorKind.INDEXED_SET;
    case "+"  : return OperatorKind.ADD;
    case "-"  : return OperatorKind.SUB;
    case "*"  : return OperatorKind.MUL;
    case "/"  : return OperatorKind.DIV;
    case "%"  : return OperatorKind.REM;
    case "**" : return OperatorKind.POW;
    case "&"  : return OperatorKind.AND;
    case "|"  : return OperatorKind.OR;
    case "^"  : return OperatorKind.XOR;
    case "==" : return OperatorKind.EQ;
    case "!=" : return OperatorKind.NE;
    case ">"  : return OperatorKind.GT;
    case ">=" : return OperatorKind.GE;
    case "<"  : return OperatorKind.LT;
    case "<=" : return OperatorKind.LE;
  }
  return OperatorKind.INVALID;
}

const noTypesYet = new Map<string,Type>();

/** Represents an AssemblyScript program. */
export class Program extends DiagnosticEmitter {

  /** Array of source files. */
  sources: Source[];
  /** Diagnostic offset used where repeatedly obtaining the next diagnostic. */
  diagnosticsOffset: i32 = 0;
  /** Compiler options. */
  options: Options;
  /** Elements by internal name. */
  elementsLookup: Map<string,Element> = new Map();
  /** Types by internal name. */
  typesLookup: Map<string,Type> = noTypesYet;
  /** Declared type aliases. */
  typeAliases: Map<string,TypeAlias> = new Map();
  /** File-level exports by exported name. */
  fileLevelExports: Map<string,Element> = new Map();
  /** Module-level exports by exported name. */
  moduleLevelExports: Map<string,Element> = new Map();
  /** Array prototype reference. */
  arrayPrototype: ClassPrototype | null = null;
  /** ArrayBufferView prototype reference. */
  arrayBufferViewPrototype: InterfacePrototype | null = null;
  /** String instance reference. */
  stringInstance: Class | null = null;

  /** Target expression of the previously resolved property or element access. */
  resolvedThisExpression: Expression | null = null;
  /** Element expression of the previously resolved element access. */
  resolvedElementExpression : Expression | null = null;

  /** Constructs a new program, optionally inheriting parser diagnostics. */
  constructor(diagnostics: DiagnosticMessage[] | null = null) {
    super(diagnostics);
    this.sources = [];
  }

  /** Gets a source by its exact path. */
  getSource(normalizedPath: string): Source | null {
    var sources = this.sources;
    for (let i = 0, k = sources.length; i < k; ++i) {
      let source = sources[i];
      if (source.normalizedPath == normalizedPath) return source;
    }
    return null;
  }

  /** Looks up the source for the specified possibly ambiguous path. */
  lookupSourceByPath(normalizedPathWithoutExtension: string): Source | null {
    return (
      this.getSource(normalizedPathWithoutExtension + ".ts") ||
      this.getSource(normalizedPathWithoutExtension + "/index.ts") ||
      this.getSource(LIBRARY_PREFIX + normalizedPathWithoutExtension + ".ts") ||
      this.getSource(LIBRARY_PREFIX + normalizedPathWithoutExtension + "/index.ts")
    );
  }

  /** Initializes the program and its elements prior to compilation. */
  initialize(options: Options): void {
    this.options = options;
    this.typesLookup = new Map([
      ["i8", Type.i8],
      ["i16", Type.i16],
      ["i32", Type.i32],
      ["i64", Type.i64],
      ["isize", options.isizeType],
      ["u8", Type.u8],
      ["u16", Type.u16],
      ["u32", Type.u32],
      ["u64", Type.u64],
      ["usize", options.usizeType],
      ["bool", Type.bool],
      ["f32", Type.f32],
      ["f64", Type.f64],
      ["void", Type.void],
      ["number", Type.f64],
      ["boolean", Type.bool]
    ]);

    var queuedExports = new Map<string,QueuedExport>();
    var queuedImports = new Array<QueuedImport>();
    var queuedExtends = new Array<ClassPrototype>();
    var queuedImplements = new Array<ClassPrototype>();

    // build initial lookup maps of internal names to declarations
    for (let i = 0, k = this.sources.length; i < k; ++i) {
      let source = this.sources[i];
      let statements = source.statements;
      for (let j = 0, l = statements.length; j < l; ++j) {
        let statement = statements[j];
        switch (statement.kind) {
          case NodeKind.CLASSDECLARATION: {
            this.initializeClass(<ClassDeclaration>statement, queuedExtends, queuedImplements);
            break;
          }
          case NodeKind.ENUMDECLARATION: {
            this.initializeEnum(<EnumDeclaration>statement);
            break;
          }
          case NodeKind.EXPORT: {
            this.initializeExports(<ExportStatement>statement, queuedExports);
            break;
          }
          case NodeKind.FUNCTIONDECLARATION: {
            this.initializeFunction(<FunctionDeclaration>statement);
            break;
          }
          case NodeKind.IMPORT: {
            this.initializeImports(<ImportStatement>statement, queuedExports, queuedImports);
            break;
          }
          case NodeKind.INTERFACEDECLARATION: {
            this.initializeInterface(<InterfaceDeclaration>statement);
            break;
          }
          case NodeKind.NAMESPACEDECLARATION: {
            this.initializeNamespace(<NamespaceDeclaration>statement, queuedExtends, queuedImplements);
            break;
          }
          case NodeKind.TYPEDECLARATION: {
            this.initializeTypeAlias(<TypeDeclaration>statement);
            break;
          }
          case NodeKind.VARIABLE: {
            this.initializeVariables(<VariableStatement>statement);
            break;
          }
        }
      }
    }

    // queued imports should be resolvable now through traversing exports and queued exports
    for (let i = 0; i < queuedImports.length;) {
      let queuedImport = queuedImports[i];
      let element = this.tryResolveImport(queuedImport.referencedName, queuedExports);
      if (element) {
        this.elementsLookup.set(queuedImport.internalName, element);
        queuedImports.splice(i, 1);
      } else {
        if (element = this.tryResolveImport(queuedImport.referencedNameAlt, queuedExports)) {
          this.elementsLookup.set(queuedImport.internalName, element);
          queuedImports.splice(i, 1);
        } else {
          this.error(
            DiagnosticCode.Module_0_has_no_exported_member_1,
            queuedImport.declaration.range,
            (<ImportStatement>queuedImport.declaration.parent).path.value,
            queuedImport.declaration.externalName.text
          );
          ++i;
        }
      }
    }

    // queued exports should be resolvable now that imports are finalized
    for (let [exportName, queuedExport] of queuedExports) {
      let currentExport: QueuedExport | null = queuedExport; // nullable below
      let element: Element | null;
      do {
        if (currentExport.isReExport) {
          if (element = this.fileLevelExports.get(currentExport.referencedName)) {
            this.setExportAndCheckLibrary(
              exportName,
              element,
              currentExport.member.externalName
            );
            break;
          }
          currentExport = queuedExports.get(currentExport.referencedName);
          if (!currentExport) {
            this.error(
              DiagnosticCode.Module_0_has_no_exported_member_1,
              queuedExport.member.externalName.range,
              (<StringLiteralExpression>(<ExportStatement>queuedExport.member.parent).path).value,
              queuedExport.member.externalName.text
            );
          }
        } else {
          if (
            // normal export
            (element = this.elementsLookup.get(currentExport.referencedName)) ||
            // library re-export
            (element = this.elementsLookup.get(currentExport.member.name.text))
          ) {
            this.setExportAndCheckLibrary(
              exportName,
              element,
              currentExport.member.externalName
            );
          } else {
            this.error(
              DiagnosticCode.Cannot_find_name_0,
              queuedExport.member.range, queuedExport.member.name.text
            );
          }
          break;
        }
      } while (currentExport);
    }

    // resolve base prototypes of derived classes
    for (let i = 0, k = queuedExtends.length; i < k; ++i) {
      let derivedPrototype = queuedExtends[i];
      let derivedDeclaration = derivedPrototype.declaration;
      let derivedType = assert(derivedDeclaration.extendsType);
      let baseElement = this.resolveIdentifier(derivedType.name, null); // reports
      if (!baseElement) continue;
      if (baseElement.kind == ElementKind.CLASS_PROTOTYPE) {
        let basePrototype = <ClassPrototype>baseElement;
        derivedPrototype.basePrototype = basePrototype;
      } else {
        this.error(
          DiagnosticCode.A_class_may_only_extend_another_class,
          derivedType.range
        );
      }
    }

    // set up global aliases
    var globalAliases = options.globalAliases;
    if (globalAliases) {
      for (let [alias, name] of globalAliases) {
        let element = this.elementsLookup.get(name); // TODO: error? has no source range
        if (element) this.elementsLookup.set(alias, element);
      }
    }

    // register 'Array'
    var arrayPrototype = this.elementsLookup.get("Array");
    if (arrayPrototype) {
      assert(arrayPrototype.kind == ElementKind.CLASS_PROTOTYPE);
      this.arrayPrototype = <ClassPrototype>arrayPrototype;
    }

    // register 'ArrayBufferView'
    var arrayBufferViewPrototype = this.elementsLookup.get("ArrayBufferView");
    if (arrayBufferViewPrototype) {
      assert(arrayBufferViewPrototype.kind == ElementKind.INTERFACE_PROTOTYPE);
      this.arrayBufferViewPrototype = <InterfacePrototype>arrayBufferViewPrototype;
    }

    // register 'String'
    var stringPrototype = this.elementsLookup.get("String");
    if (stringPrototype) {
      assert(stringPrototype.kind == ElementKind.CLASS_PROTOTYPE);
      let stringInstance = (<ClassPrototype>stringPrototype).resolve(null); // reports
      if (stringInstance) {
        if (this.typesLookup.has("string")) {
          let declaration = (<ClassPrototype>stringPrototype).declaration;
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, declaration.programLevelInternalName
          );
        } else {
          this.stringInstance = stringInstance;
          this.typesLookup.set("string", stringInstance.type);
        }
      }
    }
  }

  /** Tries to resolve an import by traversing exports and queued exports. */
  private tryResolveImport(
    referencedName: string,
    queuedExports: Map<string,QueuedExport>
  ): Element | null {
    var element: Element | null;
    var fileLevelExports = this.fileLevelExports;
    do {
      if (element = fileLevelExports.get(referencedName)) return element;
      let queuedExport = queuedExports.get(referencedName);
      if (!queuedExport) return null;
      if (queuedExport.isReExport) {
        referencedName = queuedExport.referencedName;
        continue;
      }
      return this.elementsLookup.get(queuedExport.referencedName);
    } while (true);
  }

  private filterDecorators(decorators: DecoratorNode[], acceptedFlags: DecoratorFlags): DecoratorFlags {
    var presentFlags = DecoratorFlags.NONE;
    for (let i = 0, k = decorators.length; i < k; ++i) {
      let decorator = decorators[i];
      if (decorator.name.kind == NodeKind.IDENTIFIER) {
        let name = (<IdentifierExpression>decorator.name).text;
        let kind = stringToDecoratorKind(name);
        let flag = decoratorKindToFlag(kind);
        if (flag) {
          if (!(acceptedFlags & flag)) {
            this.error(
              DiagnosticCode.Decorator_0_is_not_valid_here,
              decorator.range, name
            );
          } else if (presentFlags & flag) {
            this.error(
              DiagnosticCode.Duplicate_decorator,
              decorator.range, name
            );
          } else {
            presentFlags |= flag;
          }
        }
      }
    }
    return presentFlags;
  }

  /** Processes global options, if present. */
  private checkGlobalOptions(
    element: Element,
    declaration: DeclarationStatement
  ): void {
    var parentNode = declaration.parent;
    if (
      (element.hasDecorator(DecoratorFlags.GLOBAL)) ||
      (
        declaration.range.source.isLibrary &&
        element.is(CommonFlags.EXPORT) &&
        (
          assert(parentNode).kind == NodeKind.SOURCE ||
          (
            <Node>parentNode).kind == NodeKind.VARIABLE &&
            assert((<Node>parentNode).parent).kind == NodeKind.SOURCE
          )
        )
    ) {
      let simpleName = declaration.name.text;
      if (this.elementsLookup.has(simpleName)) {
        this.error(
          DiagnosticCode.Duplicate_identifier_0,
          declaration.name.range, element.internalName
        );
      } else {
        this.elementsLookup.set(simpleName, element);
        if (element.is(CommonFlags.BUILTIN)) {
          element.internalName = simpleName;
        }
      }
    }
  }

  private initializeClass(
    declaration: ClassDeclaration,
    queuedExtends: ClassPrototype[],
    queuedImplements: ClassPrototype[],
    namespace: Element | null = null
  ): void {
    var internalName = declaration.fileLevelInternalName;
    if (this.elementsLookup.has(internalName)) {
      this.error(
        DiagnosticCode.Duplicate_identifier_0,
        declaration.name.range, internalName
      );
      return;
    }

    var decorators = declaration.decorators;
    var simpleName = declaration.name.text;
    var prototype = new ClassPrototype(
      this,
      simpleName,
      internalName,
      declaration,
      decorators
        ? this.filterDecorators(decorators,
            DecoratorFlags.GLOBAL |
            DecoratorFlags.SEALED |
            DecoratorFlags.UNMANAGED
          )
        : DecoratorFlags.NONE
    );
    prototype.namespace = namespace;
    this.elementsLookup.set(internalName, prototype);

    var implementsTypes = declaration.implementsTypes;
    if (implementsTypes) {
      let numImplementsTypes = implementsTypes.length;
      if (prototype.hasDecorator(DecoratorFlags.UNMANAGED)) {
        if (numImplementsTypes) {
          this.error(
            DiagnosticCode.Unmanaged_classes_cannot_implement_interfaces,
            Range.join(
              declaration.name.range,
              implementsTypes[numImplementsTypes - 1].range
            )
          );
        }

      // remember classes that implement interfaces
      } else if (numImplementsTypes) {
        queuedImplements.push(prototype);
      }
    }

    // remember classes that extend another one
    if (declaration.extendsType) queuedExtends.push(prototype);

    // add as namespace member if applicable
    if (namespace) {
      if (namespace.members) {
        if (namespace.members.has(simpleName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        namespace.members = new Map();
      }
      namespace.members.set(simpleName, prototype);
      if (namespace.is(CommonFlags.MODULE_EXPORT)) {
        if (prototype.is(CommonFlags.EXPORT)) {
          prototype.set(CommonFlags.MODULE_EXPORT);
        }
      }

    // otherwise add to file-level exports if exported
    } else if (prototype.is(CommonFlags.EXPORT)) {
      if (this.fileLevelExports.has(internalName)) {
        this.error(
          DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
          declaration.name.range, internalName
        );
        return;
      }
      this.fileLevelExports.set(internalName, prototype);
      if (prototype.is(CommonFlags.EXPORT) && declaration.range.source.isEntry) {
        if (this.moduleLevelExports.has(internalName)) {
          this.error(
            DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
            declaration.name.range, internalName
          );
          return;
        }
        prototype.set(CommonFlags.MODULE_EXPORT);
        this.moduleLevelExports.set(internalName, prototype);
      }
    }

    // initialize members
    var memberDeclarations = declaration.members;
    for (let i = 0, k = memberDeclarations.length; i < k; ++i) {
      let memberDeclaration = memberDeclarations[i];
      switch (memberDeclaration.kind) {
        case NodeKind.FIELDDECLARATION: {
          this.initializeField(<FieldDeclaration>memberDeclaration, prototype);
          break;
        }
        case NodeKind.METHODDECLARATION: {
          if (memberDeclaration.isAny(CommonFlags.GET | CommonFlags.SET)) {
            this.initializeAccessor(<MethodDeclaration>memberDeclaration, prototype);
          } else {
            this.initializeMethod(<MethodDeclaration>memberDeclaration, prototype);
          }
          break;
        }
        default: {
          throw new Error("class member expected");
        }
      }
    }

    this.checkGlobalOptions(prototype, declaration);
  }

  private initializeField(
    declaration: FieldDeclaration,
    classPrototype: ClassPrototype
  ): void {
    var name = declaration.name.text;
    var internalName = declaration.fileLevelInternalName;

    // static fields become global variables
    if (declaration.is(CommonFlags.STATIC)) {
      if (this.elementsLookup.has(internalName)) {
        this.error(
          DiagnosticCode.Duplicate_identifier_0,
          declaration.name.range, internalName
        );
        return;
      }
      if (classPrototype.members) {
        if (classPrototype.members.has(name)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        classPrototype.members = new Map();
      }
      let staticField = new Global(
        this,
        name,
        internalName,
        Type.void, // resolved later on
        declaration
      );
      classPrototype.members.set(name, staticField);
      this.elementsLookup.set(internalName, staticField);

    // instance fields are remembered until resolved
    } else {
      if (classPrototype.instanceMembers) {
        if (classPrototype.instanceMembers.has(name)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        classPrototype.instanceMembers = new Map();
      }
      let instanceField = new FieldPrototype(
        classPrototype,
        name,
        internalName,
        declaration
      );
      classPrototype.instanceMembers.set(name, instanceField);
    }
  }

  private initializeMethod(
    declaration: MethodDeclaration,
    classPrototype: ClassPrototype
  ): void {
    var simpleName = declaration.name.text;
    var internalName = declaration.fileLevelInternalName;
    var prototype: FunctionPrototype | null = null;

    var decorators = declaration.decorators;
    var decoratorFlags = DecoratorFlags.NONE;
    if (decorators) {
      decoratorFlags = this.filterDecorators(decorators,
        DecoratorFlags.INLINE
      );
    }

    // static methods become global functions
    if (declaration.is(CommonFlags.STATIC)) {
      assert(declaration.name.kind != NodeKind.CONSTRUCTOR);

      if (this.elementsLookup.has(internalName)) {
        this.error(
          DiagnosticCode.Duplicate_identifier_0, declaration.name.range,
          internalName
        );
        return;
      }
      if (classPrototype.members) {
        if (classPrototype.members.has(simpleName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        classPrototype.members = new Map();
      }
      prototype = new FunctionPrototype(
        this,
        simpleName,
        internalName,
        declaration,
        classPrototype,
        decoratorFlags
      );
      classPrototype.members.set(simpleName, prototype);
      this.elementsLookup.set(internalName, prototype);
      if (classPrototype.is(CommonFlags.MODULE_EXPORT)) {
        prototype.set(CommonFlags.MODULE_EXPORT);
      }

    // instance methods are remembered until resolved
    } else {
      if (classPrototype.instanceMembers) {
        if (classPrototype.instanceMembers.has(simpleName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        classPrototype.instanceMembers = new Map();
      }
      prototype = new FunctionPrototype(
        this,
        simpleName,
        internalName,
        declaration,
        classPrototype,
        decoratorFlags
      );
      // if (classPrototype.isUnmanaged && instancePrototype.isAbstract) {
      //   this.error( Unmanaged classes cannot declare abstract methods. );
      // }
      if (declaration.name.kind == NodeKind.CONSTRUCTOR) {
        if (classPrototype.constructorPrototype) {
          this.error(
            DiagnosticCode.Multiple_constructor_implementations_are_not_allowed,
            declaration.name.range
          );
        } else {
          prototype.set(CommonFlags.CONSTRUCTOR);
          classPrototype.constructorPrototype = prototype;
        }
      } else {
        classPrototype.instanceMembers.set(simpleName, prototype);
      }
      if (classPrototype.is(CommonFlags.MODULE_EXPORT)) {
        prototype.set(CommonFlags.MODULE_EXPORT);
      }
    }

    this.checkOperatorOverloads(declaration.decorators, prototype, classPrototype);
  }

  private checkOperatorOverloads(
    decorators: DecoratorNode[] | null,
    prototype: FunctionPrototype,
    classPrototype: ClassPrototype
  ): void {
    // handle operator annotations. operators are either instance methods taking
    // a second argument of the instance's type or static methods taking two
    // arguments of the instance's type. return values vary depending on the
    // operation.
    if (decorators) {
      for (let i = 0, k = decorators.length; i < k; ++i) {
        let decorator = decorators[i];
        if (decorator.decoratorKind == DecoratorKind.OPERATOR) {
          let numArgs = decorator.arguments && decorator.arguments.length || 0;
          if (numArgs == 1) {
            let firstArg = (<Expression[]>decorator.arguments)[0];
            if (
              firstArg.kind == NodeKind.LITERAL &&
              (<LiteralExpression>firstArg).literalKind == LiteralKind.STRING
            ) {
              let kind = operatorKindFromString((<StringLiteralExpression>firstArg).value);
              if (kind == OperatorKind.INVALID) {
                this.error(
                  DiagnosticCode.Operation_not_supported,
                  firstArg.range
                );
              } else {
                let overloads = classPrototype.overloadPrototypes;
                if (overloads.has(kind)) {
                  this.error(
                    DiagnosticCode.Duplicate_function_implementation,
                    firstArg.range
                  );
                } else {
                  prototype.operatorKind = kind;
                  overloads.set(kind, prototype);
                }
              }
            } else {
              this.error(
                DiagnosticCode.String_literal_expected,
                firstArg.range
              );
            }
          } else {
            this.error(
              DiagnosticCode.Expected_0_arguments_but_got_1,
              decorator.range, "1", numArgs.toString(0)
            );
          }
        }
      }
    }
  }

  private initializeAccessor(
    declaration: MethodDeclaration,
    classPrototype: ClassPrototype
  ): void {
    var simpleName = declaration.name.text;
    var internalPropertyName = declaration.fileLevelInternalName;
    var propertyElement = this.elementsLookup.get(internalPropertyName);
    var isGetter = declaration.is(CommonFlags.GET);
    var isNew = false;
    if (propertyElement) {
      if (
        propertyElement.kind != ElementKind.PROPERTY ||
        (isGetter
          ? (<Property>propertyElement).getterPrototype
          : (<Property>propertyElement).setterPrototype
        ) != null
      ) {
        this.error(
          DiagnosticCode.Duplicate_identifier_0,
          declaration.name.range, internalPropertyName
        );
        return;
      }
    } else {
      propertyElement = new Property(
        this,
        simpleName,
        internalPropertyName,
        classPrototype
      );
      isNew = true;
    }

    var decorators = declaration.decorators;
    var decoratorFlags = DecoratorFlags.NONE;
    if (decorators) {
      decoratorFlags = this.filterDecorators(decorators,
        DecoratorFlags.INLINE
      );
    }

    var baseName = (isGetter ? GETTER_PREFIX : SETTER_PREFIX) + simpleName;

    // static accessors become global functions
    if (declaration.is(CommonFlags.STATIC)) {
      let staticName = classPrototype.internalName + STATIC_DELIMITER + baseName;
      if (this.elementsLookup.has(staticName)) {
        this.error(
          DiagnosticCode.Duplicate_identifier_0,
          declaration.name.range, staticName
        );
        return;
      }
      let staticPrototype = new FunctionPrototype(
        this,
        baseName,
        staticName,
        declaration,
        null,
        decoratorFlags
      );
      if (isGetter) {
        (<Property>propertyElement).getterPrototype = staticPrototype;
      } else {
        (<Property>propertyElement).setterPrototype = staticPrototype;
      }
      if (isNew) {
        if (classPrototype.members) {
          if (classPrototype.members.has(simpleName)) {
            this.error(
              DiagnosticCode.Duplicate_identifier_0,
              declaration.name.range, staticName
            );
            return;
          }
        } else {
          classPrototype.members = new Map();
        }
        classPrototype.members.set(simpleName, propertyElement); // check above
      } else {
        assert(classPrototype.members && classPrototype.members.has(simpleName));
      }
      this.elementsLookup.set(internalPropertyName, propertyElement);
      if (classPrototype.is(CommonFlags.MODULE_EXPORT)) {
        propertyElement.set(CommonFlags.MODULE_EXPORT);
      }

    // instance accessors are remembered until resolved
    } else {
      let instanceName = classPrototype.internalName + INSTANCE_DELIMITER + baseName;
      if (classPrototype.instanceMembers) {
        if (classPrototype.instanceMembers.has(baseName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalPropertyName
          );
          return;
        }
      } else {
        classPrototype.instanceMembers = new Map();
      }
      let instancePrototype = new FunctionPrototype(
        this,
        baseName,
        instanceName,
        declaration,
        classPrototype,
        decoratorFlags
      );
      if (isGetter) {
        (<Property>propertyElement).getterPrototype = instancePrototype;
      } else {
        (<Property>propertyElement).setterPrototype = instancePrototype;
      }
      classPrototype.instanceMembers.set(baseName, propertyElement);
      this.elementsLookup.set(internalPropertyName, propertyElement);
      if (classPrototype.is(CommonFlags.MODULE_EXPORT)) {
        propertyElement.set(CommonFlags.MODULE_EXPORT);
      }
    }
  }

  private initializeEnum(
    declaration: EnumDeclaration,
    namespace: Element | null = null
  ): void {
    var internalName = declaration.fileLevelInternalName;
    if (this.elementsLookup.has(internalName)) {
      this.error(
        DiagnosticCode.Duplicate_identifier_0,
        declaration.name.range, internalName
      );
      return;
    }
    var simpleName = declaration.name.text;
    var element = new Enum(this, simpleName, internalName, declaration);
    element.namespace = namespace;
    this.elementsLookup.set(internalName, element);

    if (namespace) {
      if (namespace.members) {
        if (namespace.members.has(simpleName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        namespace.members = new Map();
      }
      namespace.members.set(simpleName, element);
      if (namespace.is(CommonFlags.MODULE_EXPORT)) {
        element.set(CommonFlags.MODULE_EXPORT);
      }
    } else if (element.is(CommonFlags.EXPORT)) { // no namespace
      if (this.fileLevelExports.has(internalName)) {
        this.error(
          DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
          declaration.name.range, internalName
        );
        return;
      }
      this.fileLevelExports.set(internalName, element);
      if (declaration.range.source.isEntry) {
        if (this.moduleLevelExports.has(internalName)) {
          this.error(
            DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
            declaration.name.range, internalName
          );
          return;
        }
        element.set(CommonFlags.MODULE_EXPORT);
        this.moduleLevelExports.set(internalName, element);
      }
    }

    var values = declaration.values;
    for (let i = 0, k = values.length; i < k; ++i) {
      this.initializeEnumValue(values[i], element);
    }

    this.checkGlobalOptions(element, declaration);
  }

  private initializeEnumValue(
    declaration: EnumValueDeclaration,
    enm: Enum
  ): void {
    var name = declaration.name.text;
    var internalName = declaration.fileLevelInternalName;
    var isModuleExport = enm.is(CommonFlags.MODULE_EXPORT);
    if (enm.members) {
      if (enm.members.has(name)) {
        this.error(
          DiagnosticCode.Duplicate_identifier_0,
          declaration.name.range, internalName
        );
        return;
      }
    } else {
      enm.members = new Map();
    }
    var value = new EnumValue(enm, this, name, internalName, declaration);
    enm.members.set(name, value);
    if (isModuleExport) {
      value.set(CommonFlags.MODULE_EXPORT);
    }
  }

  private initializeExports(
    statement: ExportStatement,
    queuedExports: Map<string,QueuedExport>
  ): void {
    var members = statement.members;
    for (let i = 0, k = members.length; i < k; ++i) {
      this.initializeExport(members[i], statement.internalPath, queuedExports);
    }
  }

  private setExportAndCheckLibrary(
    name: string,
    element: Element,
    identifier: IdentifierExpression
  ): void {
    this.fileLevelExports.set(name, element);
    if (identifier.range.source.isLibrary) { // add global alias
      if (this.elementsLookup.has(identifier.text)) {
        this.error(
          DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
          identifier.range, identifier.text
        );
      } else {
        element.internalName = identifier.text;
        this.elementsLookup.set(identifier.text, element);
      }
    }
  }

  private initializeExport(
    member: ExportMember,
    internalPath: string | null,
    queuedExports: Map<string,QueuedExport>
  ): void {
    var externalName = member.range.source.internalPath + PATH_DELIMITER + member.externalName.text;
    if (this.fileLevelExports.has(externalName)) {
      this.error(
        DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
        member.externalName.range, externalName
      );
      return;
    }
    var referencedName: string;
    var referencedElement: Element | null;
    var queuedExport: QueuedExport | null;

    // export local element
    if (internalPath == null) {
      referencedName = member.range.source.internalPath + PATH_DELIMITER + member.name.text;

      // resolve right away if the element exists
      if (referencedElement = this.elementsLookup.get(referencedName)) {
        this.setExportAndCheckLibrary(
          externalName,
          referencedElement,
          member.externalName
        );
        return;
      }

      // otherwise queue it
      if (queuedExports.has(externalName)) {
        this.error(
          DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
          member.externalName.range, externalName
        );
        return;
      }
      queuedExport = new QueuedExport();
      queuedExport.isReExport = false;
      queuedExport.referencedName = referencedName; // -> internal name
      queuedExport.member = member;
      queuedExports.set(externalName, queuedExport);

    // export external element
    } else {
      referencedName = internalPath + PATH_DELIMITER + member.name.text;

      // resolve right away if the export exists
      referencedElement = this.elementsLookup.get(referencedName);
      if (referencedElement) {
        this.setExportAndCheckLibrary(
          externalName,
          referencedElement,
          member.externalName
        );
        return;
      }

      // walk already known queued exports
      let seen = new Set<QueuedExport>();
      while (queuedExport = queuedExports.get(referencedName)) {
        if (queuedExport.isReExport) {
          referencedElement = this.fileLevelExports.get(queuedExport.referencedName);
          if (referencedElement) {
            this.setExportAndCheckLibrary(
              externalName,
              referencedElement,
              member.externalName
            );
            return;
          }
          referencedName = queuedExport.referencedName;
          if (seen.has(queuedExport)) break;
          seen.add(queuedExport);
        } else {
          referencedElement = this.elementsLookup.get(queuedExport.referencedName);
          if (referencedElement) {
            this.setExportAndCheckLibrary(
              externalName,
              referencedElement,
              member.externalName
            );
            return;
          }
          break;
        }
      }

      // otherwise queue it
      if (queuedExports.has(externalName)) {
        this.error(
          DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
          member.externalName.range, externalName
        );
        return;
      }
      queuedExport = new QueuedExport();
      queuedExport.isReExport = true;
      queuedExport.referencedName = referencedName; // -> export name
      queuedExport.member = member;
      queuedExports.set(externalName, queuedExport);
    }
  }

  private initializeFunction(
    declaration: FunctionDeclaration,
    namespace: Element | null = null
  ): void {
    var internalName = declaration.fileLevelInternalName;
    if (this.elementsLookup.has(internalName)) {
      this.error(
        DiagnosticCode.Duplicate_identifier_0,
        declaration.name.range, internalName
      );
      return;
    }
    var simpleName = declaration.name.text;
    var decorators = declaration.decorators;
    var prototype = new FunctionPrototype(
      this,
      simpleName,
      internalName,
      declaration,
      null,
      decorators
        ? this.filterDecorators(decorators,
            DecoratorFlags.GLOBAL |
            DecoratorFlags.INLINE
          )
        : DecoratorFlags.NONE
    );
    prototype.namespace = namespace;
    this.elementsLookup.set(internalName, prototype);

    if (namespace) {
      if (namespace.members) {
        if (namespace.members.has(simpleName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        namespace.members = new Map();
      }
      namespace.members.set(simpleName, prototype);
      if (namespace.is(CommonFlags.MODULE_EXPORT) && prototype.is(CommonFlags.EXPORT)) {
        prototype.set(CommonFlags.MODULE_EXPORT);
      }
    } else if (prototype.is(CommonFlags.EXPORT)) { // no namespace
      if (this.fileLevelExports.has(internalName)) {
        this.error(
          DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
          declaration.name.range, internalName
        );
        return;
      }
      this.fileLevelExports.set(internalName, prototype);
      if (declaration.range.source.isEntry) {
        if (this.moduleLevelExports.has(internalName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
        prototype.set(CommonFlags.MODULE_EXPORT);
        this.moduleLevelExports.set(internalName, prototype);
      }
    }

    this.checkGlobalOptions(prototype, declaration);
  }

  private initializeImports(
    statement: ImportStatement,
    queuedExports: Map<string,QueuedExport>,
    queuedImports: QueuedImport[]
  ): void {
    var declarations = statement.declarations;
    if (declarations) {
      for (let i = 0, k = declarations.length; i < k; ++i) {
        this.initializeImport(
          declarations[i],
          statement.internalPath,
          queuedExports, queuedImports
        );
      }
    } else if (statement.namespaceName) {
      let internalName = (
        statement.range.source.internalPath +
        PATH_DELIMITER +
        statement.namespaceName.text
      );
      if (this.elementsLookup.has(internalName)) {
        this.error(
          DiagnosticCode.Duplicate_identifier_0,
          statement.namespaceName.range,
          internalName
        );
        return;
      }
      this.error( // TODO
        DiagnosticCode.Operation_not_supported,
        statement.range
      );
    }
  }

  private initializeImport(
    declaration: ImportDeclaration,
    internalPath: string,
    queuedExports: Map<string,QueuedExport>,
    queuedImports: QueuedImport[]
  ): void {
    var internalName = declaration.fileLevelInternalName;
    if (this.elementsLookup.has(internalName)) {
      this.error(
        DiagnosticCode.Duplicate_identifier_0,
        declaration.name.range, internalName
      );
      return;
    }

    var referencedName = internalPath + PATH_DELIMITER + declaration.externalName.text;

    // resolve right away if the exact export exists
    var element: Element | null;
    if (element = this.fileLevelExports.get(referencedName)) {
      this.elementsLookup.set(internalName, element);
      return;
    }

    // otherwise queue it
    var indexPart = PATH_DELIMITER + "index";
    var queuedImport = new QueuedImport();
    queuedImport.internalName = internalName;
    if (internalPath.endsWith(indexPart)) {
      queuedImport.referencedName = referencedName; // try exact first
      queuedImport.referencedNameAlt = (
        internalPath.substring(0, internalPath.length - indexPart.length + 1) +
        declaration.externalName.text
      );
    } else {
      queuedImport.referencedName = referencedName; // try exact first
      queuedImport.referencedNameAlt = (
        internalPath +
        indexPart +
        PATH_DELIMITER +
        declaration.externalName.text
      );
    }
    queuedImport.declaration = declaration;
    queuedImports.push(queuedImport);
  }

  private initializeInterface(declaration: InterfaceDeclaration, namespace: Element | null = null): void {
    var internalName = declaration.fileLevelInternalName;
    if (this.elementsLookup.has(internalName)) {
      this.error(
        DiagnosticCode.Duplicate_identifier_0,
        declaration.name.range, internalName
      );
      return;
    }

    var decorators = declaration.decorators;
    var prototype = new InterfacePrototype(
      this,
      declaration.name.text,
      internalName,
      declaration,
      decorators
        ? this.filterDecorators(decorators, DecoratorFlags.GLOBAL)
        : DecoratorFlags.NONE
    );
    prototype.namespace = namespace;
    this.elementsLookup.set(internalName, prototype);

    if (namespace) {
      if (namespace.members) {
        if (namespace.members.has(prototype.internalName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        namespace.members = new Map();
      }
      namespace.members.set(prototype.internalName, prototype);
      if (namespace.is(CommonFlags.MODULE_EXPORT) && prototype.is(CommonFlags.EXPORT)) {
        prototype.set(CommonFlags.MODULE_EXPORT);
      }
    } else if (prototype.is(CommonFlags.EXPORT)) { // no namespace
      if (this.fileLevelExports.has(internalName)) {
        this.error(
          DiagnosticCode.Export_declaration_conflicts_with_exported_declaration_of_0,
          declaration.name.range, internalName
        );
        return;
      }
      this.fileLevelExports.set(internalName, prototype);
      if (declaration.range.source.isEntry) {
        if (this.moduleLevelExports.has(internalName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
        prototype.set(CommonFlags.MODULE_EXPORT);
        this.moduleLevelExports.set(internalName, prototype);
      }
    }

    var memberDeclarations = declaration.members;
    for (let i = 0, k = memberDeclarations.length; i < k; ++i) {
      let memberDeclaration = memberDeclarations[i];
      switch (memberDeclaration.kind) {

        case NodeKind.FIELDDECLARATION: {
          this.initializeField(<FieldDeclaration>memberDeclaration, prototype);
          break;
        }
        case NodeKind.METHODDECLARATION: {
          if (memberDeclaration.isAny(CommonFlags.GET | CommonFlags.SET)) {
            this.initializeAccessor(<MethodDeclaration>memberDeclaration, prototype);
          } else {
            this.initializeMethod(<MethodDeclaration>memberDeclaration, prototype);
          }
          break;
        }
        default: {
          throw new Error("interface member expected");
        }
      }
    }

    this.checkGlobalOptions(prototype, declaration);
  }

  private initializeNamespace(
    declaration: NamespaceDeclaration,
    queuedExtends: ClassPrototype[],
    queuedImplements: ClassPrototype[],
    parentNamespace: Element | null = null
  ): void {
    var internalName = declaration.fileLevelInternalName;
    var simpleName = declaration.name.text;
    var namespace = this.elementsLookup.get(internalName);
    if (!namespace) {
      namespace = new Namespace(this, simpleName, internalName, declaration);
      namespace.namespace = parentNamespace;
      this.elementsLookup.set(internalName, namespace);
      this.checkGlobalOptions(namespace, declaration);
    }

    if (parentNamespace) {
      if (parentNamespace.members) {
        if (parentNamespace.members.has(simpleName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
      } else {
        parentNamespace.members = new Map();
      }
      parentNamespace.members.set(simpleName, namespace);
      if (parentNamespace.is(CommonFlags.MODULE_EXPORT) && namespace.is(CommonFlags.EXPORT)) {
        namespace.set(CommonFlags.MODULE_EXPORT);
      }
    } else if (namespace.is(CommonFlags.EXPORT)) { // no parent namespace
      let existingExport = this.fileLevelExports.get(internalName);
      if (existingExport) {
        if (!existingExport.is(CommonFlags.EXPORT)) {
          this.error(
            DiagnosticCode.Individual_declarations_in_merged_declaration_0_must_be_all_exported_or_all_local,
            declaration.name.range, namespace.internalName
          ); // recoverable
        }
        namespace = existingExport; // join
      } else {
        this.fileLevelExports.set(internalName, namespace);
      }
      if (declaration.range.source.isEntry) {
        if (this.moduleLevelExports.has(internalName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
          return;
        }
        namespace.set(CommonFlags.MODULE_EXPORT);
        this.moduleLevelExports.set(internalName, namespace);
      }
    }

    var members = declaration.members;
    for (let i = 0, k = members.length; i < k; ++i) {
      switch (members[i].kind) {
        case NodeKind.CLASSDECLARATION: {
          this.initializeClass(<ClassDeclaration>members[i], queuedExtends, queuedImplements, namespace);
          break;
        }
        case NodeKind.ENUMDECLARATION: {
          this.initializeEnum(<EnumDeclaration>members[i], namespace);
          break;
        }
        case NodeKind.FUNCTIONDECLARATION: {
          this.initializeFunction(<FunctionDeclaration>members[i], namespace);
          break;
        }
        case NodeKind.INTERFACEDECLARATION: {
          this.initializeInterface(<InterfaceDeclaration>members[i], namespace);
          break;
        }
        case NodeKind.NAMESPACEDECLARATION: {
          this.initializeNamespace(<NamespaceDeclaration>members[i], queuedExtends, queuedImplements, namespace);
          break;
        }
        case NodeKind.TYPEDECLARATION: {
          // this.initializeTypeAlias(<TypeDeclaration>members[i], namespace);
          // TODO: what about namespaced types?
          this.error(
            DiagnosticCode.Operation_not_supported,
            members[i].range
          );
          break;
        }
        case NodeKind.VARIABLE: {
          this.initializeVariables(<VariableStatement>members[i], namespace);
          break;
        }
        default: {
          throw new Error("namespace member expected");
        }
      }
    }
  }

  private initializeTypeAlias(declaration: TypeDeclaration, namespace: Element | null = null): void {
    // type aliases are program globals
    // TODO: what about namespaced types?
    var name = declaration.name.text;
    if (this.typesLookup.has(name) || this.typeAliases.has(name)) {
      this.error(
        DiagnosticCode.Duplicate_identifier_0,
        declaration.name.range, name
      );
      return;
    }
    var alias = new TypeAlias();
    alias.typeParameters = declaration.typeParameters;
    alias.type = declaration.type;
    this.typeAliases.set(name, alias);
  }

  private initializeVariables(statement: VariableStatement, namespace: Element | null = null): void {
    var declarations = statement.declarations;
    for (let i = 0, k = declarations.length; i < k; ++i) {
      let declaration = declarations[i];
      let internalName = declaration.fileLevelInternalName;
      if (this.elementsLookup.has(internalName)) {
        this.error(
          DiagnosticCode.Duplicate_identifier_0,
          declaration.name.range, internalName
        );
        continue;
      }
      let simpleName = declaration.name.text;
      let global = new Global(
        this,
        simpleName,
        internalName,
        Type.void, // resolved later on
        declaration
      );
      global.namespace = namespace;
      this.elementsLookup.set(internalName, global);

      if (namespace) {
        if (namespace.members) {
          if (namespace.members.has(simpleName)) {
            this.error(
              DiagnosticCode.Duplicate_identifier_0,
              declaration.name.range, internalName
            );
            continue;
          }
        } else {
          namespace.members = new Map();
        }
        namespace.members.set(simpleName, global);
        if (namespace.is(CommonFlags.MODULE_EXPORT) && global.is(CommonFlags.EXPORT)) {
          global.set(CommonFlags.MODULE_EXPORT);
        }
      } else if (global.is(CommonFlags.EXPORT)) { // no namespace
        if (this.fileLevelExports.has(internalName)) {
          this.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range, internalName
          );
        } else {
          this.fileLevelExports.set(internalName, global);
        }
        if (declaration.range.source.isEntry) {
          if (this.moduleLevelExports.has(internalName)) {
            this.error(
              DiagnosticCode.Duplicate_identifier_0,
              declaration.name.range, internalName
            );
            continue;
          }
          global.set(CommonFlags.MODULE_EXPORT);
          this.moduleLevelExports.set(internalName, global);
        }
      }
      this.checkGlobalOptions(global, declaration);
    }
  }

  /** Resolves a {@link SignatureNode} to a concrete {@link Signature}. */
  resolveSignature(
    node: SignatureNode,
    contextualTypeArguments: Map<string,Type> | null = null,
    reportNotFound: bool = true
  ): Signature | null {
    var explicitThisType = node.explicitThisType;
    var thisType: Type | null = null;
    if (explicitThisType) {
      thisType = this.resolveType(
        explicitThisType,
        contextualTypeArguments,
        reportNotFound
      );
      if (!thisType) return null;
    }
    var parameterTypeNodes = node.parameterTypes;
    var numParameters = parameterTypeNodes.length;
    var parameterTypes = new Array<Type>(numParameters);
    var parameterNames = new Array<string>(numParameters);
    var requiredParameters = 0;
    var hasRest = false;
    for (let i = 0; i < numParameters; ++i) {
      let parameterTypeNode = parameterTypeNodes[i];
      switch (parameterTypeNode.parameterKind) {
        case ParameterKind.DEFAULT: {
          requiredParameters = i + 1;
          break;
        }
        case ParameterKind.REST: {
          assert(i == numParameters);
          hasRest = true;
          break;
        }
      }
      let parameterType = this.resolveType(
        assert(parameterTypeNode.type),
        contextualTypeArguments,
        reportNotFound
      );
      if (!parameterType) return null;
      parameterTypes[i] = parameterType;
      parameterNames[i] = parameterTypeNode.name.text;
    }
    var returnTypeNode = node.returnType;
    var returnType: Type | null;
    if (returnTypeNode) {
      returnType = this.resolveType(
        returnTypeNode,
        contextualTypeArguments,
        reportNotFound
      );
      if (!returnType) return null;
    } else {
      returnType = Type.void;
    }
    var signature = new Signature(parameterTypes, returnType, thisType);
    signature.parameterNames = parameterNames;
    signature.requiredParameters = requiredParameters;
    signature.hasRest = hasRest;
    return signature;
  }

  /** Resolves a {@link CommonTypeNode} to a concrete {@link Type}. */
  resolveType(
    node: CommonTypeNode,
    contextualTypeArguments: Map<string,Type> | null = null,
    reportNotFound: bool = true
  ): Type | null {
    if (node.kind == NodeKind.SIGNATURE) {
      let signature = this.resolveSignature(<SignatureNode>node, contextualTypeArguments, reportNotFound);
      if (!signature) return null;
      return Type.u32.asFunction(signature);
    }
    var typeNode = <TypeNode>node;
    var simpleName = typeNode.name.text;
    var globalName = simpleName;
    var localName = typeNode.range.source.internalPath + PATH_DELIMITER + simpleName;

    var element: Element | null;

    // check file-global / program-global element
    if ((element = this.elementsLookup.get(localName)) || (element = this.elementsLookup.get(globalName))) {
      switch (element.kind) {
        case ElementKind.CLASS_PROTOTYPE: {
          let instance = (<ClassPrototype>element).resolveUsingTypeArguments(
            typeNode.typeArguments,
            contextualTypeArguments,
            null
          ); // reports
          return instance ? instance.type : null;
        }
      }
    }

    // check (global) type alias
    var alias = this.typeAliases.get(simpleName);
    if (alias) return this.resolveType(alias.type, contextualTypeArguments, reportNotFound);

    // resolve parameters
    if (typeNode.typeArguments) {
      let k = typeNode.typeArguments.length;
      let paramTypes = new Array<Type>(k);
      for (let i = 0; i < k; ++i) {
        let paramType = this.resolveType( // reports
          typeNode.typeArguments[i],
          contextualTypeArguments,
          reportNotFound
        );
        if (!paramType) return null;
        paramTypes[i] = paramType;
      }

      if (k) { // can't be a placeholder if it has parameters
        let instanceKey = typesToString(paramTypes);
        if (instanceKey.length) {
          localName += "<" + instanceKey + ">";
          globalName += "<" + instanceKey + ">";
        }
      } else if (contextualTypeArguments) {
        let placeholderType = contextualTypeArguments.get(globalName);
        if (placeholderType) return placeholderType;
      }
    }

    var type: Type | null;

    // check file-global / program-global type
    if ((type = this.typesLookup.get(localName)) || (type = this.typesLookup.get(globalName))) {
      return type;
    }

    if (reportNotFound) {
      this.error(
        DiagnosticCode.Cannot_find_name_0,
        typeNode.name.range, globalName
      );
    }
    return null;
  }

  /** Resolves an array of type arguments to concrete types. */
  resolveTypeArguments(
    typeParameters: TypeParameterNode[],
    typeArgumentNodes: CommonTypeNode[] | null,
    contextualTypeArguments: Map<string,Type> | null = null,
    alternativeReportNode: Node | null = null
  ): Type[] | null {
    var parameterCount = typeParameters.length;
    var argumentCount = typeArgumentNodes ? typeArgumentNodes.length : 0;
    if (parameterCount != argumentCount) {
      if (argumentCount) {
        this.error(
          DiagnosticCode.Expected_0_type_arguments_but_got_1,
          Range.join(
            (<TypeNode[]>typeArgumentNodes)[0].range,
            (<TypeNode[]>typeArgumentNodes)[argumentCount - 1].range
          ),
          parameterCount.toString(10), argumentCount.toString(10)
        );
      } else if (alternativeReportNode) {
        this.error(
          DiagnosticCode.Expected_0_type_arguments_but_got_1,
          alternativeReportNode.range.atEnd, parameterCount.toString(10), "0"
        );
      }
      return null;
    }
    var typeArguments = new Array<Type>(parameterCount);
    for (let i = 0; i < parameterCount; ++i) {
      let type = this.resolveType( // reports
        (<TypeNode[]>typeArgumentNodes)[i],
        contextualTypeArguments,
        true
      );
      if (!type) return null;
      // TODO: check extendsType
      typeArguments[i] = type;
    }
    return typeArguments;
  }

  /** Resolves an identifier to the element it refers to. */
  resolveIdentifier(
    identifier: IdentifierExpression,
    contextualFunction: Function | null,
    contextualEnum: Enum | null = null
  ): Element | null {
    var name = identifier.text;

    var element: Element | null;
    var namespace: Element | null;

    // check siblings
    if (contextualEnum) {

      if (
        contextualEnum.members &&
        (element = contextualEnum.members.get(name)) &&
        element.kind == ElementKind.ENUMVALUE
      ) {
        this.resolvedThisExpression = null;
        this.resolvedElementExpression = null;
        return element; // ENUMVALUE
      }

    } else if (contextualFunction) {

      // check locals
      if (element = contextualFunction.flow.getScopedLocal(name)) {
        this.resolvedThisExpression = null;
        this.resolvedElementExpression = null;
        return element; // LOCAL
      }

      // check outer scope locals
      // let outerScope = contextualFunction.outerScope;
      // while (outerScope) {
      //   if (element = outerScope.getScopedLocal(name)) {
      //     let scopedLocal = <Local>element;
      //     let scopedGlobal = scopedLocal.scopedGlobal;
      //     if (!scopedGlobal) scopedGlobal = outerScope.addScopedGlobal(scopedLocal);
      //     if (!resolvedElement) resolvedElement = new ResolvedElement();
      //     return resolvedElement.set(scopedGlobal);
      //   }
      //   outerScope = outerScope.currentFunction.outerScope;
      // }

      // search contextual parent namespaces if applicable
      if (namespace = contextualFunction.prototype.namespace) {
        do {
          if (element = this.elementsLookup.get(namespace.internalName + STATIC_DELIMITER + name)) {
            this.resolvedThisExpression = null;
            this.resolvedElementExpression = null;
            return element; // LOCAL
          }
        } while (namespace = namespace.namespace);
      }
    }

    // search current file
    if (element = this.elementsLookup.get(identifier.range.source.internalPath + PATH_DELIMITER + name)) {
      this.resolvedThisExpression = null;
      this.resolvedElementExpression = null;
      return element; // GLOBAL, FUNCTION_PROTOTYPE, CLASS_PROTOTYPE
    }

    // search global scope
    if (element = this.elementsLookup.get(name)) {
      this.resolvedThisExpression = null;
      this.resolvedElementExpression = null;
      return element; // GLOBAL, FUNCTION_PROTOTYPE, CLASS_PROTOTYPE
    }

    this.error(
      DiagnosticCode.Cannot_find_name_0,
      identifier.range, name
    );
    return null;
  }

  /** Resolves a property access to the element it refers to. */
  resolvePropertyAccess(
    propertyAccess: PropertyAccessExpression,
    contextualFunction: Function
  ): Element | null {
    // start by resolving the lhs target (expression before the last dot)
    var targetExpression = propertyAccess.expression;
    var target = this.resolveExpression(targetExpression, contextualFunction); // reports
    if (!target) return null;

    // at this point we know exactly what the target is, so look up the element within
    var propertyName = propertyAccess.property.text;

    // Resolve variable-likes to the class type they reference first
    switch (target.kind) {
      case ElementKind.GLOBAL:
      case ElementKind.LOCAL:
      case ElementKind.FIELD: {
        let classReference = (<VariableLikeElement>target).type.classReference;
        if (!classReference) {
          this.error(
            DiagnosticCode.Property_0_does_not_exist_on_type_1,
            propertyAccess.property.range, propertyName, (<VariableLikeElement>target).type.toString()
          );
          return null;
        }
        target = classReference;
        break;
      }
      case ElementKind.PROPERTY: {
        let getter = assert((<Property>target).getterPrototype).resolve(); // reports
        if (!getter) return null;
        let classReference = getter.signature.returnType.classReference;
        if (!classReference) {
          this.error(
            DiagnosticCode.Property_0_does_not_exist_on_type_1,
            propertyAccess.property.range, propertyName, getter.signature.returnType.toString()
          );
          return null;
        }
        target = classReference;
        break;
      }
      case ElementKind.CLASS: {
        let elementExpression = this.resolvedElementExpression;
        if (elementExpression) {
          let indexedGet = (<Class>target).lookupOverload(OperatorKind.INDEXED_GET);
          if (!indexedGet) {
            this.error(
              DiagnosticCode.Index_signature_is_missing_in_type_0,
              elementExpression.range, (<Class>target).internalName
            );
            return null;
          }
          let returnType = indexedGet.signature.returnType;
          if (!(target = returnType.classReference)) {
            this.error(
              DiagnosticCode.Property_0_does_not_exist_on_type_1,
              propertyAccess.property.range, propertyName, returnType.toString()
            );
            return null;
          }
        }
        break;
      }
    }

    // Look up the member within
    switch (target.kind) {
      case ElementKind.CLASS_PROTOTYPE:
      case ElementKind.CLASS: {
        do {
          let members = target.members;
          let member: Element | null;
          if (members && (member = members.get(propertyName))) {
            this.resolvedThisExpression = targetExpression;
            this.resolvedElementExpression = null;
            return member; // instance FIELD, static GLOBAL, FUNCTION_PROTOTYPE...
          }
          // traverse inherited static members on the base prototype if target is a class prototype
          if (target.kind == ElementKind.CLASS_PROTOTYPE) {
            if ((<ClassPrototype>target).basePrototype) {
              target = <ClassPrototype>(<ClassPrototype>target).basePrototype;
            } else {
              break;
            }
          // traverse inherited instance members on the base class if target is a class instance
          } else if (target.kind == ElementKind.CLASS) {
            if ((<Class>target).base) {
              target = <Class>(<Class>target).base;
            } else {
              break;
            }
          } else {
            break;
          }
        } while (true);
        break;
      }
      default: { // enums or other namespace-like elements
        let members = target.members;
        let member: Element | null;
        if (members && (member = members.get(propertyName))) {
          this.resolvedThisExpression = targetExpression;
          this.resolvedElementExpression = null;
          return member; // static ENUMVALUE, static GLOBAL, static FUNCTION_PROTOTYPE...
        }
        break;
      }
    }
    this.error(
      DiagnosticCode.Property_0_does_not_exist_on_type_1,
      propertyAccess.property.range, propertyName, target.internalName
    );
    return null;
  }

  resolveElementAccess(
    elementAccess: ElementAccessExpression,
    contextualFunction: Function
  ): Element | null {
    var targetExpression = elementAccess.expression;
    var target = this.resolveExpression(targetExpression, contextualFunction);
    if (!target) return null;
    switch (target.kind) {
      case ElementKind.GLOBAL:
      case ElementKind.LOCAL:
      case ElementKind.FIELD: {
        let type = (<VariableLikeElement>target).type;
        if (target = type.classReference) {
          this.resolvedThisExpression = targetExpression;
          this.resolvedElementExpression = elementAccess.elementExpression;
          return target;
        }
        break;
      }
      case ElementKind.CLASS: { // element access on element access
        let indexedGet = (<Class>target).lookupOverload(OperatorKind.INDEXED_GET);
        if (!indexedGet) {
          this.error(
            DiagnosticCode.Index_signature_is_missing_in_type_0,
            elementAccess.range, (<Class>target).internalName
          );
          return null;
        }
        let returnType = indexedGet.signature.returnType;
        if (target = returnType.classReference) {
          this.resolvedThisExpression = targetExpression;
          this.resolvedElementExpression = elementAccess.elementExpression;
          return target;
        }
        break;
      }
    }
    this.error(
      DiagnosticCode.Operation_not_supported,
      targetExpression.range
    );
    return null;
  }

  resolveExpression(
    expression: Expression,
    contextualFunction: Function
  ): Element | null {
    while (expression.kind == NodeKind.PARENTHESIZED) {
      expression = (<ParenthesizedExpression>expression).expression;
    }
    switch (expression.kind) {
      case NodeKind.ASSERTION: {
        let type = this.resolveType((<AssertionExpression>expression).toType); // reports
        if (type) {
          let classType = type.classReference;
          if (classType) {
            this.resolvedThisExpression = null;
            this.resolvedElementExpression = null;
            return classType;
          }
        }
        return null;
      }
      case NodeKind.BINARY: { // TODO: string concatenation, mostly
        throw new Error("not implemented");
      }
      case NodeKind.THIS: { // -> Class / ClassPrototype
        if (contextualFunction.flow.is(FlowFlags.INLINE_CONTEXT)) {
          let explicitLocal = contextualFunction.flow.getScopedLocal("this");
          if (explicitLocal) {
            this.resolvedThisExpression = null;
            this.resolvedElementExpression = null;
            return explicitLocal;
          }
        }
        let parent = contextualFunction.memberOf;
        if (parent) {
          this.resolvedThisExpression = null;
          this.resolvedElementExpression = null;
          return parent;
        }
        this.error(
          DiagnosticCode._this_cannot_be_referenced_in_current_location,
          expression.range
        );
        return null;
      }
      case NodeKind.SUPER: { // -> Class
        if (contextualFunction.flow.is(FlowFlags.INLINE_CONTEXT)) {
          let explicitLocal = contextualFunction.flow.getScopedLocal("super");
          if (explicitLocal) {
            this.resolvedThisExpression = null;
            this.resolvedElementExpression = null;
            return explicitLocal;
          }
        }
        let parent = contextualFunction.memberOf;
        if (parent && parent.kind == ElementKind.CLASS && (parent = (<Class>parent).base)) {
          this.resolvedThisExpression = null;
          this.resolvedElementExpression = null;
          return parent;
        }
        this.error(
          DiagnosticCode._super_can_only_be_referenced_in_a_derived_class,
          expression.range
        );
        return null;
      }
      case NodeKind.IDENTIFIER: {
        return this.resolveIdentifier(<IdentifierExpression>expression, contextualFunction);
      }
      case NodeKind.LITERAL: {
        switch ((<LiteralExpression>expression).literalKind) {
          case LiteralKind.STRING: {
            this.resolvedThisExpression = expression;
            this.resolvedElementExpression = null;
            return this.stringInstance;
          }
          // case LiteralKind.ARRAY: // TODO
        }
        break;
      }
      case NodeKind.PROPERTYACCESS: {
        return this.resolvePropertyAccess(
          <PropertyAccessExpression>expression,
          contextualFunction
        );
      }
      case NodeKind.ELEMENTACCESS: {
        return this.resolveElementAccess(
          <ElementAccessExpression>expression,
          contextualFunction
        );
      }
      case NodeKind.CALL: {
        let targetExpression = (<CallExpression>expression).expression;
        let target = this.resolveExpression(targetExpression, contextualFunction); // reports
        if (!target) return null;
        if (target.kind == ElementKind.FUNCTION_PROTOTYPE) {
          let instance = (<FunctionPrototype>target).resolveUsingTypeArguments( // reports
            (<CallExpression>expression).typeArguments,
            contextualFunction.flow.contextualTypeArguments,
            expression
          );
          if (!instance) return null;
          let returnType = instance.signature.returnType;
          let classType = returnType.classReference;
          if (classType) {
            // reuse resolvedThisExpression (might be property access)
            // reuse resolvedElementExpression (might be element access)
            return classType;
          } else {
            let signature = returnType.signatureReference;
            if (signature) {
              let functionTarget = signature.cachedFunctionTarget;
              if (!functionTarget) {
                functionTarget = new FunctionTarget(this, signature);
                signature.cachedFunctionTarget = functionTarget;
              }
              // reuse resolvedThisExpression (might be property access)
              // reuse resolvedElementExpression (might be element access)
              return functionTarget;
            }
          }
          this.error(
            DiagnosticCode.Cannot_invoke_an_expression_whose_type_lacks_a_call_signature_Type_0_has_no_compatible_call_signatures,
            targetExpression.range, target.internalName
          );
          return null;
        }
        break;
      }
    }
    this.error(
      DiagnosticCode.Operation_not_supported,
      expression.range
    );
    return null;
  }
}

/** Indicates the specific kind of an {@link Element}. */
export enum ElementKind {
  /** A {@link Global}. */
  GLOBAL,
  /** A {@link Local}. */
  LOCAL,
  /** An {@link Enum}. */
  ENUM,
  /** An {@link EnumValue}. */
  ENUMVALUE,
  /** A {@link FunctionPrototype}. */
  FUNCTION_PROTOTYPE,
  /** A {@link Function}. */
  FUNCTION,
  /** A {@link FunctionTarget}. */
  FUNCTION_TARGET,
  /** A {@link ClassPrototype}. */
  CLASS_PROTOTYPE,
  /** A {@link Class}. */
  CLASS,
  /** An {@link InterfacePrototype}. */
  INTERFACE_PROTOTYPE,
  /** An {@link Interface}. */
  INTERFACE,
  /** A {@link FieldPrototype}. */
  FIELD_PROTOTYPE,
  /** A {@link Field}. */
  FIELD,
  /** A {@link Property}. */
  PROPERTY,
  /** A {@link Namespace}. */
  NAMESPACE
}

/** Indicates traits of a {@link Node} or {@link Element}. */
export enum CommonFlags {
  /** No flags set. */
  NONE = 0,

  // Basic modifiers

  /** Has an `import` modifier. */
  IMPORT = 1 << 0,
  /** Has an `export` modifier. */
  EXPORT = 1 << 1,
  /** Has a `declare` modifier. */
  DECLARE = 1 << 2,
  /** Has a `const` modifier. */
  CONST = 1 << 3,
  /** Has a `let` modifier. */
  LET = 1 << 4,
  /** Has a `static` modifier. */
  STATIC = 1 << 5,
  /** Has a `readonly` modifier. */
  READONLY = 1 << 6,
  /** Has an `abstract` modifier. */
  ABSTRACT = 1 << 7,
  /** Has a `public` modifier. */
  PUBLIC = 1 << 8,
  /** Has a `private` modifier. */
  PRIVATE = 1 << 9,
  /** Has a `protected` modifier. */
  PROTECTED = 1 << 10,
  /** Has a `get` modifier. */
  GET = 1 << 11,
  /** Has a `set` modifier. */
  SET = 1 << 12,

  // Extended modifiers usually derived from basic modifiers

  /** Is ambient, that is either declared or nested in a declared element. */
  AMBIENT = 1 << 13,
  /** Is generic. */
  GENERIC = 1 << 14,
  /** Is part of a generic context. */
  GENERIC_CONTEXT = 1 << 15,
  /** Is an instance member. */
  INSTANCE = 1 << 16,
  /** Is a constructor. */
  CONSTRUCTOR = 1 << 17,
  /** Is an arrow function. */
  ARROW = 1 << 18,
  /** Is a module export. */
  MODULE_EXPORT = 1 << 19,
  /** Is a module import. */
  MODULE_IMPORT = 1 << 20,

  // Compilation states

  /** Is a builtin. */
  BUILTIN = 1 << 21,
  /** Is compiled. */
  COMPILED = 1 << 22,
  /** Has a constant value and is therefore inlined. */
  INLINED = 1 << 23,
  /** Is scoped. */
  SCOPED = 1 << 24,
  /** Is a trampoline. */
  TRAMPOLINE = 1 << 25
}

export enum DecoratorFlags {
  /** No flags set. */
  NONE = 0,
  /** Is a program global. */
  GLOBAL = 1 << 0,
  /** Is an unmanaged class. */
  UNMANAGED = 1 << 2,
  /** Is a sealed class. */
  SEALED = 1 << 3,
  /** Is always inlined. */
  INLINE = 1 << 4
}

export function decoratorKindToFlag(kind: DecoratorKind): DecoratorFlags {
  switch (kind) {
    case DecoratorKind.GLOBAL: return DecoratorFlags.GLOBAL;
    case DecoratorKind.UNMANAGED: return DecoratorFlags.UNMANAGED;
    case DecoratorKind.SEALED: return DecoratorFlags.SEALED;
    case DecoratorKind.INLINE: return DecoratorFlags.INLINE;
    default: return DecoratorFlags.NONE;
  }
}

/** Base class of all program elements. */
export abstract class Element {

  /** Specific element kind. */
  kind: ElementKind;
  /** Containing {@link Program}. */
  program: Program;
  /** Simple name. */
  simpleName: string;
  /** Internal name referring to this element. */
  internalName: string;
  /** Common flags indicating specific traits. */
  flags: CommonFlags = CommonFlags.NONE;
  /** Decorator flags indicating annotated traits. */
  decoratorFlags: DecoratorFlags = DecoratorFlags.NONE;
  /** Namespaced member elements. */
  members: Map<string,Element> | null = null;
  /** Parent namespace, if applicable. */
  namespace: Element | null = null;

  /** Constructs a new element, linking it to its containing {@link Program}. */
  protected constructor(program: Program, simpleName: string, internalName: string) {
    this.program = program;
    this.simpleName = simpleName;
    this.internalName = internalName;
  }

  /** Tests if this element has a specific flag or flags. */
  is(flag: CommonFlags): bool { return (this.flags & flag) == flag; }
  /** Tests if this element has any of the specified flags. */
  isAny(flags: CommonFlags): bool { return (this.flags & flags) != 0; }
  /** Sets a specific flag or flags. */
  set(flag: CommonFlags): void { this.flags |= flag; }
  /** Tests if this element has a specific decorator flag or flags. */
  hasDecorator(flag: DecoratorFlags): bool { return (this.decoratorFlags & flag) == flag; }
}

/** A namespace. */
export class Namespace extends Element {

  // All elements have namespace semantics. This is an explicitly declared one.
  kind = ElementKind.NAMESPACE;

  /** Declaration reference. */
  declaration: NamespaceDeclaration; // more specific

  /** Constructs a new namespace. */
  constructor(
    program: Program,
    simpleName: string,
    internalName: string,
    declaration: NamespaceDeclaration
  ) {
    super(program, simpleName, internalName);
    this.declaration = declaration;
    this.flags = declaration.flags;
  }
}

/** An enum. */
export class Enum extends Element {

  kind = ElementKind.ENUM;

  /** Declaration reference. */
  declaration: EnumDeclaration;

  /** Constructs a new enum. */
  constructor(
    program: Program,
    simpleName: string,
    internalName: string,
    declaration: EnumDeclaration
  ) {
    super(program, simpleName, internalName);
    this.declaration = declaration;
    this.flags = declaration.flags;
  }
}

/** An enum value. */
export class EnumValue extends Element {

  kind = ElementKind.ENUMVALUE;

  /** Declaration reference. */
  declaration: EnumValueDeclaration;
  /** Parent enum. */
  enum: Enum;
  /** Constant value, if applicable. */
  constantValue: i32 = 0;

  constructor(
    enm: Enum,
    program: Program,
    simpleName: string,
    internalName: string,
    declaration: EnumValueDeclaration
  ) {
    super(program, simpleName, internalName);
    this.enum = enm;
    this.declaration = declaration;
  }
}

export const enum ConstantValueKind {
  NONE,
  INTEGER,
  FLOAT
}

export class VariableLikeElement extends Element {

  // kind varies

  /** Declaration reference. */
  declaration: VariableLikeDeclarationStatement | null;
  /** Variable type. Is {@link Type.void} for type-inferred {@link Global}s before compilation. */
  type: Type;
  /** Constant value kind. */
  constantValueKind: ConstantValueKind = ConstantValueKind.NONE;
  /** Constant integer value, if applicable. */
  constantIntegerValue: I64;
  /** Constant float value, if applicable. */
  constantFloatValue: f64;

  protected constructor(
    program: Program,
    simpleName: string,
    internalName: string,
    type: Type,
    declaration: VariableLikeDeclarationStatement | null
  ) {
    super(program, simpleName, internalName);
    this.type = type;
    this.declaration = declaration;
  }

  withConstantIntegerValue(lo: i32, hi: i32): this {
    this.constantValueKind = ConstantValueKind.INTEGER;
    this.constantIntegerValue = i64_new(lo, hi);
    this.set(CommonFlags.CONST | CommonFlags.INLINED);
    return this;
  }

  withConstantFloatValue(value: f64): this {
    this.constantValueKind = ConstantValueKind.FLOAT;
    this.constantFloatValue = value;
    this.set(CommonFlags.CONST | CommonFlags.INLINED);
    return this;
  }
}

/** A global variable. */
export class Global extends VariableLikeElement {

  kind = ElementKind.GLOBAL;

  constructor(
    program: Program,
    simpleName: string,
    internalName: string,
    type: Type,
    declaration: VariableLikeDeclarationStatement | null
  ) {
    super(program, simpleName, internalName, type, declaration);
    this.flags = declaration ? declaration.flags : CommonFlags.NONE;
    this.type = type; // resolved later if `void`
  }
}

/** A function parameter. */
export class Parameter {

  // not an Element on its own

  /** Parameter name. */
  name: string;
  /** Parameter type. */
  type: Type;
  /** Parameter initializer. */
  initializer: Expression | null;

  /** Constructs a new function parameter. */
  constructor(name: string, type: Type, initializer: Expression | null = null) {
    this.name = name;
    this.type = type;
    this.initializer = initializer;
  }
}

/** A function local. */
export class Local extends VariableLikeElement {

  kind = ElementKind.LOCAL;

  /** Local index. */
  index: i32;
  /** Respective scoped global, if any. */
  scopedGlobal: Global | null = null;

  constructor(
    program: Program,
    simpleName: string,
    index: i32,
    type: Type,
    declaration: VariableLikeDeclarationStatement | null = null
  ) {
    super(program, simpleName, simpleName, type, declaration);
    this.index = index;
  }
}

/** A yet unresolved function prototype. */
export class FunctionPrototype extends Element {

  kind = ElementKind.FUNCTION_PROTOTYPE;

  /** Declaration reference. */
  declaration: FunctionDeclaration;
  /** If an instance method, the class prototype reference. */
  classPrototype: ClassPrototype | null;
  /** Resolved instances. */
  instances: Map<string,Function> = new Map();
  /** Class type arguments, if a partially resolved method of a generic class. Not set otherwise. */
  classTypeArguments: Type[] | null = null;
  /** Operator kind, if an overload. */
  operatorKind: OperatorKind = OperatorKind.INVALID;

  /** Constructs a new function prototype. */
  constructor(
    program: Program,
    simpleName: string,
    internalName: string,
    declaration: FunctionDeclaration,
    classPrototype: ClassPrototype | null = null,
    decoratorFlags: DecoratorFlags = DecoratorFlags.NONE
  ) {
    super(program, simpleName, internalName);
    this.declaration = declaration;
    this.flags = declaration.flags;
    this.classPrototype = classPrototype;
    this.decoratorFlags = decoratorFlags;
  }

  /** Resolves this prototype to an instance using the specified concrete type arguments. */
  resolve(
    functionTypeArguments: Type[] | null = null,
    contextualTypeArguments: Map<string,Type> | null = null
  ): Function | null {
    var instanceKey = functionTypeArguments ? typesToString(functionTypeArguments) : "";
    var instance = this.instances.get(instanceKey);
    if (instance) return instance;

    var declaration = this.declaration;
    var isInstance = this.is(CommonFlags.INSTANCE);
    var classPrototype = this.classPrototype;

    // inherit contextual type arguments as provided. might be overridden.
    var inheritedTypeArguments = contextualTypeArguments;
    contextualTypeArguments = new Map();
    if (inheritedTypeArguments) {
      for (let [inheritedName, inheritedType] of inheritedTypeArguments) {
        contextualTypeArguments.set(
          inheritedName,
          inheritedType
        );
      }
    }

    // override with class type arguments if a partially resolved instance method
    var classTypeArguments = this.classTypeArguments;
    if (classTypeArguments) { // set only if partially resolved
      assert(this.is(CommonFlags.INSTANCE));
      let classDeclaration = assert(classPrototype).declaration;
      let classTypeParameters = classDeclaration.typeParameters;
      let numClassTypeParameters = classTypeParameters.length;
      assert(numClassTypeParameters == classTypeArguments.length);
      for (let i = 0; i < numClassTypeParameters; ++i) {
        contextualTypeArguments.set(
          classTypeParameters[i].name.text,
          classTypeArguments[i]
        );
      }
    } else {
      assert(!classTypeArguments);
    }

    // override with function specific type arguments
    var signatureNode = declaration.signature;
    var functionTypeParameters = declaration.typeParameters;
    var numFunctionTypeArguments: i32;
    if (functionTypeArguments && (numFunctionTypeArguments = functionTypeArguments.length)) {
      assert(functionTypeParameters && numFunctionTypeArguments == functionTypeParameters.length);
      for (let i = 0; i < numFunctionTypeArguments; ++i) {
        contextualTypeArguments.set(
          (<TypeParameterNode[]>functionTypeParameters)[i].name.text,
          functionTypeArguments[i]
        );
      }
    } else {
      assert(!functionTypeParameters || functionTypeParameters.length == 0);
    }

    // resolve class if an instance method
    var classInstance: Class | null = null;
    var thisType: Type | null = null;
    if (isInstance) {
      classInstance = assert(classPrototype).resolve(classTypeArguments, contextualTypeArguments); // reports
      if (!classInstance) return null;
      thisType = classInstance.type.asThis();
      contextualTypeArguments.set("this", thisType);
    }

    // resolve signature node
    var signatureParameters = signatureNode.parameterTypes;
    var signatureParameterCount = signatureParameters.length;
    var parameterTypes = new Array<Type>(signatureParameterCount);
    var parameterNames = new Array<string>(signatureParameterCount);
    var requiredParameters = 0;
    for (let i = 0; i < signatureParameterCount; ++i) {
      let parameterDeclaration = signatureParameters[i];
      if (parameterDeclaration.parameterKind == ParameterKind.DEFAULT) {
        requiredParameters = i + 1;
      }
      let typeNode = assert(parameterDeclaration.type);
      let parameterType = this.program.resolveType(typeNode, contextualTypeArguments, true); // reports
      if (!parameterType) return null;
      parameterTypes[i] = parameterType;
      parameterNames[i] = parameterDeclaration.name.text;
    }

    var returnType: Type;
    if (this.is(CommonFlags.SET)) {
      returnType = Type.void; // not annotated
    } else if (this.is(CommonFlags.CONSTRUCTOR)) {
      returnType = assert(classInstance).type; // not annotated
    } else {
      let typeNode = assert(signatureNode.returnType);
      let type = this.program.resolveType(typeNode, contextualTypeArguments, true); // reports
      if (!type) return null;
      returnType = type;
    }

    var signature = new Signature(parameterTypes, returnType, thisType);
    signature.parameterNames = parameterNames;
    signature.requiredParameters = requiredParameters;

    var internalName = this.internalName;
    if (instanceKey.length) internalName += "<" + instanceKey + ">";
    instance = new Function(
      this,
      internalName,
      signature,
      classInstance
        ? classInstance
        : classPrototype,
      contextualTypeArguments
    );
    this.instances.set(instanceKey, instance);
    return instance;
  }

  /** Resolves this prototype partially by applying the specified inherited class type arguments. */
  resolvePartial(classTypeArguments: Type[] | null): FunctionPrototype | null {
    assert(this.is(CommonFlags.INSTANCE));
    var classPrototype = assert(this.classPrototype);

    if (!(classTypeArguments && classTypeArguments.length)) return this; // no need to clone

    var simpleName = this.simpleName;
    var partialKey = typesToString(classTypeArguments);
    var partialPrototype = new FunctionPrototype(
      this.program,
      simpleName,
      classPrototype.internalName + "<" + partialKey + ">" + INSTANCE_DELIMITER + simpleName,
      this.declaration,
      classPrototype,
      this.decoratorFlags
    );
    partialPrototype.flags = this.flags;
    partialPrototype.operatorKind = this.operatorKind;
    partialPrototype.classTypeArguments = classTypeArguments;
    return partialPrototype;
  }

  /** Resolves the specified type arguments prior to resolving this prototype to an instance. */
  resolveUsingTypeArguments(
    typeArgumentNodes: CommonTypeNode[] | null,
    contextualTypeArguments: Map<string,Type> | null,
    reportNode: Node
  ): Function | null {
    var resolvedTypeArguments: Type[] | null = null;
    if (this.is(CommonFlags.GENERIC)) {
      assert(typeArgumentNodes != null && typeArgumentNodes.length != 0);
      resolvedTypeArguments = this.program.resolveTypeArguments(
        assert(this.declaration.typeParameters),
        typeArgumentNodes,
        contextualTypeArguments,
        reportNode
      );
      if (!resolvedTypeArguments) return null;
    }
    return this.resolve(resolvedTypeArguments, contextualTypeArguments);
  }

  /** Resolves the type arguments to use when compiling a built-in call. Must be a built-in. */
  resolveBuiltinTypeArguments(
    typeArgumentNodes: CommonTypeNode[] | null,
    contextualTypeArguments: Map<string,Type> | null
  ): Type[] | null {
    assert(this.is(CommonFlags.BUILTIN));
    var resolvedTypeArguments: Type[] | null = null;
    if (typeArgumentNodes) {
      let k = typeArgumentNodes.length;
      resolvedTypeArguments = new Array<Type>(k);
      for (let i = 0; i < k; ++i) {
        let resolvedType = this.program.resolveType( // reports
          typeArgumentNodes[i],
          contextualTypeArguments,
          true
        );
        if (!resolvedType) return null;
        resolvedTypeArguments[i] = resolvedType;
      }
    }
    return resolvedTypeArguments;
  }

  toString(): string { return this.simpleName; }
}

/** A resolved function. */
export class Function extends Element {

  kind = ElementKind.FUNCTION;

  /** Prototype reference. */
  prototype: FunctionPrototype;
  /** Function signature. */
  signature: Signature;
  /** If a member of another namespace-like element, the concrete element it is a member of. */
  memberOf: Element | null;
  /** Map of locals by name. */
  locals: Map<string,Local> = new Map();
  /** List of additional non-parameter locals. */
  additionalLocals: Type[] = [];
  /** Current break context label. */
  breakContext: string | null = null;
  /** Contextual type arguments. */
  contextualTypeArguments: Map<string,Type> | null;
  /** Current control flow. */
  flow: Flow;
  /** Remembered debug locations. */
  debugLocations: Range[] | null = null;
  /** Function reference, if compiled. */
  ref: FunctionRef = 0;
  /** Function table index, if any. */
  functionTableIndex: i32 = -1;
  /** Trampoline function for calling with omitted arguments. */
  trampoline: Function | null = null;
  /** The outer scope, if a function expression. */
  outerScope: Flow | null = null;

  private nextBreakId: i32 = 0;
  private breakStack: i32[] | null = null;
  nextInlineId: i32 = 0;

  /** Constructs a new concrete function. */
  constructor(
    prototype: FunctionPrototype,
    internalName: string,
    signature: Signature,
    memberOf: Element | null = null,
    contextualTypeArguments: Map<string,Type> | null = null
  ) {
    super(prototype.program, prototype.simpleName, internalName);
    this.prototype = prototype;
    this.signature = signature;
    this.memberOf = memberOf;
    this.flags = prototype.flags;
    this.decoratorFlags = prototype.decoratorFlags;
    this.contextualTypeArguments = contextualTypeArguments;
    if (!(prototype.is(CommonFlags.AMBIENT | CommonFlags.BUILTIN) || prototype.is(CommonFlags.DECLARE))) {
      let localIndex = 0;
      if (memberOf && memberOf.kind == ElementKind.CLASS) {
        assert(this.is(CommonFlags.INSTANCE));
        this.locals.set(
          "this",
          new Local(
            prototype.program,
            "this",
            localIndex++,
            assert(signature.thisType)
          )
        );
        let inheritedTypeArguments = (<Class>memberOf).contextualTypeArguments;
        if (inheritedTypeArguments) {
          if (!this.contextualTypeArguments) this.contextualTypeArguments = new Map();
          for (let [inheritedName, inheritedType] of inheritedTypeArguments) {
            if (!this.contextualTypeArguments.has(inheritedName)) {
              this.contextualTypeArguments.set(inheritedName, inheritedType);
            }
          }
        }
      } else {
        assert(!this.is(CommonFlags.INSTANCE)); // internal error
      }
      let parameterTypes = signature.parameterTypes;
      for (let i = 0, k = parameterTypes.length; i < k; ++i) {
        let parameterType = parameterTypes[i];
        let parameterName = signature.getParameterName(i);
        this.locals.set(
          parameterName,
          new Local(
            prototype.program,
            parameterName,
            localIndex++,
            parameterType
            // FIXME: declaration?
          )
        );
      }
    }
    this.flow = Flow.create(this);
  }

  /** Adds a local of the specified type, with an optional name. */
  addLocal(type: Type, name: string | null = null, declaration: VariableDeclaration | null = null): Local {
    // if it has a name, check previously as this method will throw otherwise
    var localIndex = this.signature.parameterTypes.length + this.additionalLocals.length;
    if (this.is(CommonFlags.INSTANCE)) ++localIndex;
    var local = new Local(
      this.prototype.program,
      name
        ? name
        : "var$" + localIndex.toString(10),
      localIndex,
      type,
      declaration
    );
    if (name) {
      if (this.locals.has(name)) throw new Error("duplicate local name");
      this.locals.set(name, local);
    }
    this.additionalLocals.push(type);
    return local;
  }

  private tempI32s: Local[] | null = null;
  private tempI64s: Local[] | null = null;
  private tempF32s: Local[] | null = null;
  private tempF64s: Local[] | null = null;

  /** Gets a free temporary local of the specified type. */
  getTempLocal(type: Type): Local {
    var temps: Local[] | null;
    switch (type.toNativeType()) {
      case NativeType.I32: {
        temps = this.tempI32s;
        break;
      }
      case NativeType.I64: {
        temps = this.tempI64s;
        break;
      }
      case NativeType.F32: {
        temps = this.tempF32s;
        break;
      }
      case NativeType.F64: {
        temps = this.tempF64s;
        break;
      }
      default: throw new Error("concrete type expected");
    }
    if (temps && temps.length) {
      let ret = temps.pop();
      ret.type = type;
      return ret;
    }
    return this.addLocal(type);
  }

  /** Frees the temporary local for reuse. */
  freeTempLocal(local: Local): void {
    if (local.is(CommonFlags.INLINED)) return;
    assert(local.index >= 0);
    var temps: Local[];
    assert(local.type != null); // internal error
    switch ((<Type>local.type).toNativeType()) {
      case NativeType.I32: {
        temps = this.tempI32s || (this.tempI32s = []);
        break;
      }
      case NativeType.I64: {
        temps = this.tempI64s || (this.tempI64s = []);
        break;
      }
      case NativeType.F32: {
        temps = this.tempF32s || (this.tempF32s = []);
        break;
      }
      case NativeType.F64: {
        temps = this.tempF64s || (this.tempF64s = []);
        break;
      }
      default: throw new Error("concrete type expected");
    }
    assert(local.index >= 0);
    temps.push(local);
  }

  /** Gets and immediately frees a temporary local of the specified type. */
  getAndFreeTempLocal(type: Type): Local {
    var temps: Local[];
    switch (type.toNativeType()) {
      case NativeType.I32: {
        temps = this.tempI32s || (this.tempI32s = []);
        break;
      }
      case NativeType.I64: {
        temps = this.tempI64s || (this.tempI64s = []);
        break;
      }
      case NativeType.F32: {
        temps = this.tempF32s || (this.tempF32s = []);
        break;
      }
      case NativeType.F64: {
        temps = this.tempF64s || (this.tempF64s = []);
        break;
      }
      default: throw new Error("concrete type expected");
    }
    if (temps.length > 0) {
      return temps[temps.length - 1];
    }
    var local: Local = this.addLocal(type);
    temps.push(local);
    return local;
  }

  /** Enters a(nother) break context. */
  enterBreakContext(): string {
    var id = this.nextBreakId++;
    if (!this.breakStack) {
      this.breakStack = [ id ];
    } else {
      this.breakStack.push(id);
    }
    return this.breakContext = id.toString(10);
  }

  /** Leaves the current break context. */
  leaveBreakContext(): void {
    assert(this.breakStack != null);
    var length = (<i32[]>this.breakStack).length;
    assert(length > 0);
    (<i32[]>this.breakStack).pop();
    if (length > 1) {
      this.breakContext = (<i32[]>this.breakStack)[length - 2].toString(10);
    } else {
      this.breakContext = null;
      this.breakStack = null;
    }
  }

  /** Finalizes the function once compiled, releasing no longer needed resources. */
  finalize(module: Module, ref: FunctionRef): void {
    this.ref = ref;
    assert(!this.breakStack || !this.breakStack.length); // internal error
    this.breakStack = null;
    this.breakContext = null;
    this.tempI32s = this.tempI64s = this.tempF32s = this.tempF64s = null;
    if (this.program.options.sourceMap) {
      let debugLocations = this.debugLocations;
      if (debugLocations) {
        for (let i = 0, k = debugLocations.length; i < k; ++i) {
          let debugLocation = debugLocations[i];
          module.setDebugLocation(
            ref,
            debugLocation.debugInfoRef,
            debugLocation.source.debugInfoIndex,
            debugLocation.line,
            debugLocation.column
          );
        }
      }
    }
    this.debugLocations = null;
  }

  /** Returns the TypeScript representation of this function. */
  toString(): string { return this.prototype.simpleName; }
}

/** A resolved function target, that is a function called indirectly by an index and signature. */
export class FunctionTarget extends Element {

  kind = ElementKind.FUNCTION_TARGET;

  /** Underlying signature. */
  signature: Signature;
  /** Function type. */
  type: Type;

  /** Constructs a new function target. */
  constructor(program: Program, signature: Signature) {
    super(program, "", "");
    var simpleName = signature.toSignatureString();
    this.simpleName = simpleName;
    this.internalName = simpleName;
    this.signature = signature;
    this.type = Type.u32.asFunction(signature);
  }
}

/** A yet unresolved instance field prototype. */
export class FieldPrototype extends Element {

  kind = ElementKind.FIELD_PROTOTYPE;

  /** Declaration reference. */
  declaration: FieldDeclaration;
  /** Parent class prototype. */
  classPrototype: ClassPrototype;

  /** Constructs a new field prototype. */
  constructor(
    classPrototype: ClassPrototype,
    simpleName: string,
    internalName: string,
    declaration: FieldDeclaration
  ) {
    super(classPrototype.program, simpleName, internalName);
    this.classPrototype = classPrototype;
    this.declaration = declaration;
    this.flags = declaration.flags;
  }
}

/** A resolved instance field. */
export class Field extends VariableLikeElement {

  kind = ElementKind.FIELD;

  /** Field prototype reference. */
  prototype: FieldPrototype;
  /** Field memory offset, if an instance field. */
  memoryOffset: i32 = -1;

  /** Constructs a new field. */
  constructor(
    prototype: FieldPrototype,
    internalName: string,
    type: Type,
    declaration: FieldDeclaration
  ) {
    super(prototype.program, prototype.simpleName, internalName, type, declaration);
    this.prototype = prototype;
    this.flags = prototype.flags;
    this.type = type;
  }
}

/** A property comprised of a getter and a setter function. */
export class Property extends Element {

  kind = ElementKind.PROPERTY;

  /** Parent class prototype. */
  parent: ClassPrototype;
  /** Getter prototype. */
  getterPrototype: FunctionPrototype | null = null;
  /** Setter prototype. */
  setterPrototype: FunctionPrototype | null = null;

  /** Constructs a new property prototype. */
  constructor(
    program: Program,
    simpleName: string,
    internalName: string,
    parent: ClassPrototype
  ) {
    super(program, simpleName, internalName);
    this.parent = parent;
  }
}

/** A yet unresolved class prototype. */
export class ClassPrototype extends Element {

  kind = ElementKind.CLASS_PROTOTYPE;

  /** Declaration reference. */
  declaration: ClassDeclaration;
  /** Resolved instances. */
  instances: Map<string,Class> = new Map();
  /** Instance member prototypes. */
  instanceMembers: Map<string,Element> | null = null;
  /** Base class prototype, if applicable. */
  basePrototype: ClassPrototype | null = null; // set in Program#initialize
  /** Constructor prototype. */
  constructorPrototype: FunctionPrototype | null = null;
  /** Operator overload prototypes. */
  overloadPrototypes: Map<OperatorKind, FunctionPrototype> = new Map();

  constructor(
    program: Program,
    simpleName: string,
    internalName: string,
    declaration: ClassDeclaration,
    decoratorFlags: DecoratorFlags
  ) {
    super(program, simpleName, internalName);
    this.declaration = declaration;
    this.flags = declaration.flags;
    this.decoratorFlags = decoratorFlags;
  }

  /** Resolves this prototype to an instance using the specified concrete type arguments. */
  resolve(
    typeArguments: Type[] | null,
    contextualTypeArguments: Map<string,Type> | null = null
  ): Class | null {
    var instanceKey = typeArguments ? typesToString(typeArguments) : "";
    var instance = this.instances.get(instanceKey);
    if (instance) return instance;

    // inherit contextual type arguments
    var inheritedTypeArguments = contextualTypeArguments;
    contextualTypeArguments = new Map();
    if (inheritedTypeArguments) {
      for (let [inheritedName, inheritedType] of inheritedTypeArguments) {
        contextualTypeArguments.set(inheritedName, inheritedType);
      }
    }

    var declaration = this.declaration;
    var baseClass: Class | null = null;
    if (declaration.extendsType) {
      let baseClassType = this.program.resolveType(declaration.extendsType, null); // reports
      if (!baseClassType) return null;
      if (!(baseClass = baseClassType.classReference)) {
        this.program.error(
          DiagnosticCode.A_class_may_only_extend_another_class,
          declaration.extendsType.range
        );
        return null;
      }
      if (baseClass.hasDecorator(DecoratorFlags.SEALED)) {
        this.program.error(
          DiagnosticCode.Class_0_is_sealed_and_cannot_be_extended,
          declaration.extendsType.range, baseClass.internalName
        );
        return null;
      }
      if (baseClass.hasDecorator(DecoratorFlags.UNMANAGED) != this.hasDecorator(DecoratorFlags.UNMANAGED)) {
        this.program.error(
          DiagnosticCode.Unmanaged_classes_cannot_extend_managed_classes_and_vice_versa,
          Range.join(declaration.name.range, declaration.extendsType.range)
        );
        return null;
      }
    }

    // override call specific contextual type arguments if provided
    var i: i32, k: i32;
    if (typeArguments) {
      if ((k = typeArguments.length) != declaration.typeParameters.length) {
        throw new Error("type argument count mismatch");
      }
      for (i = 0; i < k; ++i) {
        contextualTypeArguments.set(declaration.typeParameters[i].name.text, typeArguments[i]);
      }
    } else if (declaration.typeParameters.length) {
      throw new Error("type argument count mismatch");
    }

    var simpleName = this.simpleName;
    var internalName = this.internalName;
    if (instanceKey.length) {
      simpleName += "<" + instanceKey + ">";
      internalName += "<" + instanceKey + ">";
    }
    instance = new Class(this, simpleName, internalName, typeArguments, baseClass);
    instance.contextualTypeArguments = contextualTypeArguments;
    this.instances.set(instanceKey, instance);

    var memoryOffset: u32 = 0;
    if (baseClass) {
      memoryOffset = baseClass.currentMemoryOffset;
      if (baseClass.members) {
        if (!instance.members) instance.members = new Map();
        for (let inheritedMember of baseClass.members.values()) {
          instance.members.set(inheritedMember.simpleName, inheritedMember);
        }
      }
    }

    // Resolve constructor
    if (this.constructorPrototype) {
      let partialConstructor = this.constructorPrototype.resolvePartial(typeArguments); // reports
      if (partialConstructor) instance.constructorInstance = partialConstructor.resolve(); // reports
    }

    // Resolve instance members
    if (this.instanceMembers) {
      for (let member of this.instanceMembers.values()) {
        switch (member.kind) {

          // Lay out fields in advance
          case ElementKind.FIELD_PROTOTYPE: {
            if (!instance.members) instance.members = new Map();
            let fieldDeclaration = (<FieldPrototype>member).declaration;
            if (!fieldDeclaration.type) {
              throw new Error("type expected"); // TODO: check if parent class defines a type
            }
            let fieldType = this.program.resolveType( // reports
              fieldDeclaration.type,
              instance.contextualTypeArguments
            );
            if (fieldType) {
              let fieldInstance = new Field(
                <FieldPrototype>member,
                internalName + INSTANCE_DELIMITER + (<FieldPrototype>member).simpleName,
                fieldType,
                fieldDeclaration
              );
              switch (fieldType.byteSize) { // align
                case 1: break;
                case 2: {
                  if (memoryOffset & 1) ++memoryOffset;
                  break;
                }
                case 4: {
                  if (memoryOffset & 3) memoryOffset = (memoryOffset | 3) + 1;
                  break;
                }
                case 8: {
                  if (memoryOffset & 7) memoryOffset = (memoryOffset | 7) + 1;
                  break;
                }
                default: assert(false);
              }
              fieldInstance.memoryOffset = memoryOffset;
              memoryOffset += fieldType.byteSize;
              instance.members.set(member.simpleName, fieldInstance);
            }
            break;
          }

          // Partially resolve methods as these might have type arguments on their own
          case ElementKind.FUNCTION_PROTOTYPE: {
            if (!instance.members) instance.members = new Map();
            let partialPrototype = (<FunctionPrototype>member).resolvePartial(typeArguments); // reports
            if (partialPrototype) {
              partialPrototype.internalName = internalName + INSTANCE_DELIMITER + partialPrototype.simpleName;
              instance.members.set(member.simpleName, partialPrototype);
            }
            break;
          }

          // Clone properties and partially resolve the wrapped accessors for consistence with other methods
          case ElementKind.PROPERTY: {
            if (!instance.members) instance.members = new Map();
            let getterPrototype = assert((<Property>member).getterPrototype);
            let setterPrototype = (<Property>member).setterPrototype;
            let instanceProperty = new Property(
              this.program,
              member.simpleName,
              internalName + INSTANCE_DELIMITER + member.simpleName,
              this
            );
            let partialGetterPrototype = getterPrototype.resolvePartial(typeArguments);
            if (!partialGetterPrototype) return null;
            partialGetterPrototype.internalName = (
              internalName + INSTANCE_DELIMITER + partialGetterPrototype.simpleName
            );
            instanceProperty.getterPrototype = partialGetterPrototype;
            if (setterPrototype) {
              let partialSetterPrototype = setterPrototype.resolvePartial(typeArguments);
              if (!partialSetterPrototype) return null;
              partialSetterPrototype.internalName = (
                internalName + INSTANCE_DELIMITER + partialSetterPrototype.simpleName
              );
              instanceProperty.setterPrototype = partialSetterPrototype;
            }
            instance.members.set(member.simpleName, instanceProperty);
            break;
          }
          default: assert(false);
        }
      }
    }

    // Fully resolve operator overloads (don't have type parameters on their own)
    for (let [kind, prototype] of this.overloadPrototypes) {
      assert(kind != OperatorKind.INVALID);
      let operatorInstance: Function | null;
      if (prototype.is(CommonFlags.INSTANCE)) {
        let operatorPartial = prototype.resolvePartial(typeArguments); // reports
        if (!operatorPartial) continue;
        operatorInstance = operatorPartial.resolve(); // reports
      } else {
        operatorInstance = prototype.resolve(); // reports
      }
      if (!operatorInstance) continue;
      let overloads = instance.overloads;
      if (!overloads) instance.overloads = overloads = new Map();
      overloads.set(kind, operatorInstance);
    }

    instance.currentMemoryOffset = memoryOffset; // offsetof<this>() is the class' byte size in memory
    return instance;
  }

  /** Resolves the specified type arguments prior to resolving this prototype to an instance. */
  resolveUsingTypeArguments(
    typeArgumentNodes: CommonTypeNode[] | null,
    contextualTypeArguments: Map<string,Type> | null,
    alternativeReportNode: Node | null
  ): Class | null {
    var resolvedTypeArguments: Type[] | null = null;
    if (this.is(CommonFlags.GENERIC)) {
      assert(typeArgumentNodes != null && typeArgumentNodes.length != 0);
      resolvedTypeArguments = this.program.resolveTypeArguments(
        this.declaration.typeParameters,
        typeArgumentNodes,
        contextualTypeArguments,
        alternativeReportNode
      );
      if (!resolvedTypeArguments) return null;
    } else {
      assert(typeArgumentNodes == null || !typeArgumentNodes.length);
    }
    return this.resolve(resolvedTypeArguments, contextualTypeArguments);
  }

  toString(): string {
    return this.simpleName;
  }
}

/** A resolved class. */
export class Class extends Element {

  kind = ElementKind.CLASS;

  /** Prototype reference. */
  prototype: ClassPrototype;
  /** Resolved type arguments. */
  typeArguments: Type[] | null;
  /** Resolved class type. */
  type: Type;
  /** Base class, if applicable. */
  base: Class | null;
  /** Contextual type arguments for fields and methods. */
  contextualTypeArguments: Map<string,Type> | null = null;
  /** Current member memory offset. */
  currentMemoryOffset: u32 = 0;
  /** Constructor instance. */
  constructorInstance: Function | null = null;
  /** Operator overloads. */
  overloads: Map<OperatorKind,Function> | null = null;

  /** Constructs a new class. */
  constructor(
    prototype: ClassPrototype,
    simpleName: string,
    internalName: string,
    typeArguments: Type[] | null = null,
    base: Class | null = null
  ) {
    super(prototype.program, simpleName, internalName);
    this.prototype = prototype;
    this.flags = prototype.flags;
    this.decoratorFlags = prototype.decoratorFlags;
    this.typeArguments = typeArguments;
    this.type = prototype.program.options.usizeType.asClass(this);
    this.base = base;

    // inherit static members and contextual type arguments from base class
    if (base) {
      let inheritedTypeArguments = base.contextualTypeArguments;
      if (inheritedTypeArguments) {
        if (!this.contextualTypeArguments) this.contextualTypeArguments = new Map();
        for (let [baseName, baseType] of inheritedTypeArguments) {
          this.contextualTypeArguments.set(baseName, baseType);
        }
      }
    }

    // apply instance-specific contextual type arguments
    var declaration = this.prototype.declaration;
    var i: i32, k: i32;
    if (declaration) { // irrelevant for built-ins
      let typeParameters = declaration.typeParameters;
      if (typeArguments) {
        if ((k = typeArguments.length) != typeParameters.length) {
          throw new Error("type argument count mismatch");
        }
        if (k) {
          if (!this.contextualTypeArguments) this.contextualTypeArguments = new Map();
          for (i = 0; i < k; ++i) {
            this.contextualTypeArguments.set(typeParameters[i].name.text, typeArguments[i]);
          }
        }
      } else if (typeParameters.length) {
        throw new Error("type argument count mismatch");
      }
    }
  }

  /** Tests if a value of this class type is assignable to a target of the specified class type. */
  isAssignableTo(target: Class): bool {
    var current: Class | null = this;
    do if (current == target) return true;
    while (current = current.base);
    return false;
  }

  /** Looks up the operator overload of the specified kind. */
  lookupOverload(kind: OperatorKind): Function | null {
    var instance: Class | null = this;
    do {
      let overloads = instance.overloads;
      if (overloads) {
        let overload = overloads.get(kind);
        if (overload) return overload;
      }
    } while (instance = instance.base);
    return null;
  }

  toString(): string {
    return this.simpleName;
  }
}

/** A yet unresolved interface. */
export class InterfacePrototype extends ClassPrototype {

  kind = ElementKind.INTERFACE_PROTOTYPE;

  /** Declaration reference. */
  declaration: InterfaceDeclaration; // more specific

  /** Constructs a new interface prototype. */
  constructor(
    program: Program,
    simpleName: string,
    internalName: string,
    declaration: InterfaceDeclaration,
    decoratorFlags: DecoratorFlags
  ) {
    super(program, simpleName, internalName, declaration, decoratorFlags);
  }
}

/** A resolved interface. */
export class Interface extends Class {

  kind = ElementKind.INTERFACE;

  /** Prototype reference. */
  prototype: InterfacePrototype; // more specific
  /** Base interface, if applcable. */
  base: Interface | null; // more specific

  /** Constructs a new interface. */
  constructor(
    prototype: InterfacePrototype,
    simpleName: string,
    internalName: string,
    typeArguments: Type[] = [],
    base: Interface | null = null
  ) {
    super(prototype, simpleName, internalName, typeArguments, base);
  }
}

/** Control flow flags indicating specific conditions. */
export const enum FlowFlags {
  /** No specific conditions. */
  NONE = 0,

  /** This branch always returns. */
  RETURNS = 1 << 0,
  /** This branch always throws. */
  THROWS = 1 << 1,
  /** This branch always breaks. */
  BREAKS = 1 << 2,
  /** This branch always continues. */
  CONTINUES = 1 << 3,
  /** This branch always allocates. Constructors only. */
  ALLOCATES = 1 << 4,

  /** This branch conditionally returns in a child branch. */
  CONDITIONALLY_RETURNS = 1 << 5,
  /** This branch conditionally throws in a child branch. */
  CONDITIONALLY_THROWS = 1 << 6,
  /** This branch conditionally breaks in a child branch. */
  CONDITIONALLY_BREAKS = 1 << 7,
  /** This branch conditionally continues in a child branch. */
  CONDITIONALLY_CONTINUES = 1 << 8,
  /** This branch conditionally allocates in a child branch. Constructors only. */
  CONDITIONALLY_ALLOCATES = 1 << 9,

  /** This branch is part of inlining a function. */
  INLINE_CONTEXT = 1 << 10
}

/** A control flow evaluator. */
export class Flow {

  /** Parent flow. */
  parent: Flow | null;
  /** Flow flags indicating specific conditions. */
  flags: FlowFlags;
  /** Function this flow belongs to. */
  currentFunction: Function;
  /** The label we break to when encountering a continue statement. */
  continueLabel: string | null;
  /** The label we break to when encountering a break statement. */
  breakLabel: string | null;
  /** The label we break to when encountering a return statement, when inlining. */
  returnLabel: string | null;
  /** The current return type. */
  returnType: Type;
  /** The current contextual type arguments. */
  contextualTypeArguments: Map<string,Type> | null;
  /** Scoped local variables. */
  scopedLocals: Map<string,Local> | null = null;
  /** Scoped global variables. */
  // scopedGlobals: Map<Local,Global> | null = null;

  /** Creates the parent flow of the specified function. */
  static create(currentFunction: Function): Flow {
    var parentFlow = new Flow();
    parentFlow.parent = null;
    parentFlow.flags = FlowFlags.NONE;
    parentFlow.currentFunction = currentFunction;
    parentFlow.continueLabel = null;
    parentFlow.breakLabel = null;
    parentFlow.returnLabel = null;
    parentFlow.returnType = currentFunction.signature.returnType;
    parentFlow.contextualTypeArguments = currentFunction.contextualTypeArguments;
    return parentFlow;
  }

  private constructor() { }

  /** Tests if this flow has the specified flag or flags. */
  is(flag: FlowFlags): bool { return (this.flags & flag) == flag; }
  /** Sets the specified flag or flags. */
  set(flag: FlowFlags): void { this.flags |= flag; }
  /** Unsets the specified flag or flags. */
  unset(flag: FlowFlags): void { this.flags &= ~flag; }

  /** Enters a new branch or scope and returns the new flow. */
  enterBranchOrScope(): Flow {
    var branch = new Flow();
    branch.parent = this;
    branch.flags = this.flags;
    branch.currentFunction = this.currentFunction;
    branch.continueLabel = this.continueLabel;
    branch.breakLabel = this.breakLabel;
    branch.returnLabel = this.returnLabel;
    branch.returnType = this.returnType;
    branch.contextualTypeArguments = this.contextualTypeArguments;
    return branch;
  }

  /** Leaves the current branch or scope and returns the parent flow. */
  leaveBranchOrScope(): Flow {
    var parent = assert(this.parent);

    // Free block-scoped locals
    if (this.scopedLocals) {
      for (let scopedLocal of this.scopedLocals.values()) {
        this.currentFunction.freeTempLocal(scopedLocal);
      }
      this.scopedLocals = null;
    }

    // Propagate flags to parent
    if (this.is(FlowFlags.RETURNS)) {
      parent.set(FlowFlags.CONDITIONALLY_RETURNS);
    }
    if (this.is(FlowFlags.THROWS)) {
      parent.set(FlowFlags.CONDITIONALLY_THROWS);
    }
    if (this.is(FlowFlags.BREAKS) && parent.breakLabel == this.breakLabel) {
      parent.set(FlowFlags.CONDITIONALLY_BREAKS);
    }
    if (this.is(FlowFlags.CONTINUES) && parent.continueLabel == this.continueLabel) {
      parent.set(FlowFlags.CONDITIONALLY_CONTINUES);
    }
    if (this.is(FlowFlags.ALLOCATES)) {
      parent.set(FlowFlags.CONDITIONALLY_ALLOCATES);
    }

    return parent;
  }

  /** Adds a new scoped local of the specified name. */
  addScopedLocal(type: Type, name: string, declaration?: VariableDeclaration): Local {
    var scopedLocal = this.currentFunction.getTempLocal(type);
    if (!this.scopedLocals) this.scopedLocals = new Map();
    else {
      let existingLocal = this.scopedLocals.get(name);
      if (existingLocal) {
        if (declaration) {
          this.currentFunction.program.error(
            DiagnosticCode.Duplicate_identifier_0,
            declaration.name.range
          );
        } else assert(false);
        return existingLocal;
      }
    }
    this.scopedLocals.set(name, scopedLocal);
    return scopedLocal;
  }

  /** Gets the local of the specified name in the current scope. */
  getScopedLocal(name: string): Local | null {
    var local: Local | null;
    var current: Flow | null = this;
    do {
      if (current.scopedLocals && (local = current.scopedLocals.get(name))) {
        return local;
      }
    } while (current = current.parent);
    return this.currentFunction.locals.get(name);
  }

  /** Adds a scoped global for an outer scoped local. */
  // addScopedGlobal(scopedLocal: Local): Global {
  //   var scopedGlobals = this.scopedGlobals;
  //   var scopedGlobal: Global | null;
  //   if (!scopedGlobals) {
  //     this.scopedGlobals = scopedGlobals = new Map();
  //   } else {
  //     scopedGlobal = scopedGlobals.get(scopedLocal);
  //     if (scopedGlobal) return scopedGlobal;
  //   }
  //   scopedGlobal = new Global(
  //     scopedLocal.program,
  //     scopedLocal.simpleName,
  //     this.currentFunction.internalName + INNER_DELIMITER + scopedLocal.internalName,
  //     scopedLocal.type,
  //     assert(scopedLocal.declaration)
  //   );
  //   scopedGlobals.set(scopedLocal, scopedGlobal);
  //   return scopedGlobal;
  // }

  /** Finalizes this flow. Must be the topmost parent flow of the function. */
  finalize(): void {
    assert(this.parent == null); // must be the topmost parent flow
    this.continueLabel = null;
    this.breakLabel = null;
    this.returnLabel = null;
    this.contextualTypeArguments = null;
  }
}
