/** Names Elixir's standard library gives, read from elixir-lang/elixir's source, and how a module names its file by convention. */

const words = (s: string): ReadonlySet<string> => new Set(s.split(" "));

/** Calls by a bare name that never resolve to a function of the files: special forms and directives, and what defines. */
export const STRUCTURAL = words(
    "alias import require use quote unquote unquote_splicing case cond for receive try with fn super __block__ __aliases__ __MODULE__ __CALLER__ __ENV__ __DIR__ __STACKTRACE__ def defp defmacro defmacrop defguard defguardp defdelegate defn defnp defmodule defprotocol defimpl defstruct defexception defoverridable"
);

/** Kernel's functions and macros that evaluate their arguments as written: imported everywhere, unless an `import Kernel` leaves one out. */
export const KERNEL = words(
    "abs apply binary_part binary_slice bit_size byte_size ceil dbg destructure div elem exit floor function_exported? get_and_update_in get_in hd if inspect is_atom is_binary is_bitstring is_boolean is_exception is_float is_function is_integer is_list is_map is_map_key is_nil is_non_struct_map is_number is_pid is_port is_reference is_struct is_tuple length macro_exported? make_ref map_size match? max min node not pop_in put_elem put_in raise rem reraise round self send spawn spawn_link spawn_monitor struct struct! tap then throw tl to_charlist to_string to_timeout trunc tuple_size unless update_in defstruct defexception"
);

/** The special forms that evaluate their arguments as written; no import takes them away. */
export const FORMS = words("case cond for receive super try with");

/** ExUnit's calls that evaluate their arguments as written, `name/arity` (the arities ExUnit defines, read in elixir-lang/elixir), by the module that gives them, which `use ExUnit.Case` imports. */
export const EXUNIT: ReadonlyMap<string, string> = new Map(
    Object.entries({
        "ExUnit.Case": "test/1,2,3 describe/2",
        "ExUnit.Callbacks": "setup/1,2 setup_all/1,2 on_exit/1,2 start_supervised/1,2 start_supervised!/1,2 start_link_supervised!/1,2 stop_supervised/1 stop_supervised!/1",
        "ExUnit.Assertions": "assert/1,2 assert_in_delta/3,4 assert_raise/2,3 assert_receive/1,2,3 assert_received/1,2 catch_error/1 catch_exit/1 catch_throw/1 flunk/0,1 refute/1,2 refute_in_delta/3,4 refute_receive/1,2,3 refute_received/1,2",
        "ExUnit.CaptureIO": "capture_io/1,2,3 with_io/1,2,3",
        "ExUnit.CaptureLog": "capture_log/1,2 with_log/1,2",
    }).flatMap(([mod, names]) =>
        names.split(" ").flatMap((spec) => {
            const [name, arities] = spec.split("/");
            return arities.split(",").map((n): [string, string] => [`${name}/${n}`, mod]);
        })
    )
);

/** What `use` of ExUnit's modules imports (their `__using__`, read in elixir-lang/elixir). */
export const EXUNIT_USES: ReadonlyMap<string, string> = new Map(Object.entries({ "ExUnit.Case": "ExUnit.Case ExUnit.Callbacks ExUnit.Assertions ExUnit.DocTest", "ExUnit.CaseTemplate": "ExUnit.Callbacks ExUnit.Assertions", "ExUnit.Callbacks": "ExUnit.Callbacks" }));

/** ExUnit's calls whose block becomes a function of the test module. */
export const TEST_BODIES = words("test setup setup_all");

/** Operators no module of Elixir's needs but a library may define (Bitwise's among them), reading its operands as anything. */
export const CUSTOM_OPS = words("||| &&& <<< >>> <<~ ~>> <~ ~> <~> +++ --- ... ^^^ ~~~ <|>");

/** Kernel's operators, which an `import Kernel, except: […]` may leave out for another module's. */
export const KERNEL_OPS = words("+ - * / ** ++ -- <> == != === !== < <= > >= =~ && || ! and or not in |> .. // @");

/** The standard library's applications, whose modules' calls evaluate their arguments as written where the files don't hold them. */
export const STDLIB = words(
    "Access Agent Application Atom Base Bitwise Calendar Code Config Date DateTime Duration DynamicSupervisor Enum Exception File Float Function GenServer IO Inspect Integer JSON Kernel Keyword List Logger Macro Map MapSet Module NaiveDateTime Node OptionParser Path Port Process Protocol Range Record Regex Registry Stream String StringIO Supervisor System Task Time Tuple URI Version ExUnit Mix IEx EEx"
);

/** Of those, the ones with macros that read code as data (`IEx.Helpers.h(M.f)`, `Kernel.SpecialForms.quote`, `Kernel.defmodule`): no call is read in their calls' arguments. */
export const CODE_AS_DATA = words("IEx Kernel");

/** `use` of these injects no alias, and imports no module but ExUnit's (`EXUNIT_USES`) and `Supervisor.Spec` (their `__using__`, read in elixir-lang/elixir): a name written after it means what it meant before. */
export const NO_ALIAS_USE = words("ExUnit.Case ExUnit.CaseTemplate GenServer Supervisor DynamicSupervisor Agent Task Application Mix.Task Mix.Task.Compiler Mix.Project");

/** Standard-library modules that define no macro (read in elixir-lang/elixir): a call of theirs is a function's. */
export const FUNCTIONS_ONLY = words("Access Atom Code Enum Keyword List Macro Map Module Path String");

/** Module attributes that hold typespecs, where `f(t)` names a type. */
export const TYPESPECS = words("spec type typep opaque callback macrocallback");

/** Kernel's sigils, whose `#{…}` is evaluated as written; another sigil's macro may read it its own way. */
export const KERNEL_SIGILS = words("s S w W c C r R D N T U");

/** `Macro.underscore/1`, for the names modules have: `MyApp.HTTPClient` gives `my_app/http_client`, a module's file by convention. */
export const underscore = (s: string): string =>
    s
        .split(".")
        .map((part) => part.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase())
        .join("/");
