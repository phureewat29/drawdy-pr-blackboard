/**
 * PHP's own functions a variable is often passed to, by lowercase name, as
 * PHP 8.4's reflection gives them: those taking every argument by value,
 * and those taking some by reference, with their positions (`preg_match:2`,
 * `+` for every one from there). A function not listed may take any by
 * reference. The by-value ones are the 120 most called with a variable in
 * Composer, Laravel and Symfony, and a few that take objects: `assert`,
 * `isset`, `empty`, `get_object_vars`, `iterator_count`, `is_countable`,
 * `is_iterable`, `print_r` and `strval`.
 */

const TABLE =
    "abs array_column array_combine array_diff array_diff_key array_filter array_intersect array_intersect_key array_is_list array_key_exists array_keys " +
    "array_map array_merge array_replace array_replace_recursive array_reverse array_search array_slice array_unique array_values assert base64_encode " +
    "basename call_user_func chdir chmod class_exists copy count curl_setopt current dirname empty explode fclose file_exists file_get_contents " +
    "file_put_contents filter_var fopen fread fseek fwrite get_class get_debug_type get_object_vars gettype hash hash_equals hash_hmac http_build_query " +
    "implode in_array ini_set interface_exists is_a is_array is_bool is_countable is_dir is_file is_float is_int is_iterable is_link is_null is_numeric " +
    "is_object is_resource is_scalar is_string is_subclass_of isset iterator_count iterator_to_array json_decode json_encode key levenshtein ltrim max " +
    "mb_strlen mb_substr method_exists min mkdir parse_url pathinfo preg_quote preg_split print_r property_exists rawurlencode realpath rewind rmdir rtrim " +
    "serialize spl_object_hash spl_object_id sprintf str_contains str_ends_with str_pad str_repeat str_starts_with strcspn stream_get_contents stripos " +
    "strlen strpos strrpos strspn strtolower strtoupper strtr strval substr substr_count substr_replace tempnam touch trim ucfirst unlink unserialize " +
    "var_export version_compare array_push:0 array_unshift:0 array_walk:0 array_walk_recursive:0 is_callable:2 parse_str:1 preg_match:2 preg_match_all:2 " +
    "preg_replace:4 preg_replace_callback:4 str_ireplace:3 str_replace:3 uasort:0 uksort:0 usort:0";

export const BUILTINS: ReadonlyMap<string, string> = new Map(TABLE.split(" ").map((e) => [e.split(":")[0], e.split(":")[1] ?? ""]));

/**
 * PHPUnit's assertions, by lowercase name less `assert`: a call of one no
 * file read declares is PHPUnit's, which takes its arguments by value and
 * narrows only as `narrowing.ts` reads (`assertInstanceOf`, `assertSame`).
 * They are the ones Composer, Laravel and Symfony call, and PHPUnit's
 * others most used.
 */
const PHPUNIT_NAMES =
    "same equals true false instanceof stringcontainsstring null arrayhaskey stringnotcontainsstring arraynothaskey notsame notnull contains fileexists " +
    "notempty empty stringequalsfile isarray stringmatchesformat greaterthan lessthanorequal stringstartswith stringendswith that " +
    "jsonstringequalsjsonstring equalswithdelta lessthan notcontains greaterthanorequal notequals equalscanonicalizing directoryexists fileequals notfalse " +
    "notinstanceof isint containsonlyinstancesof xmlstringequalsxmlstring stringmatchesformatfile iscallable isfloat isbool " +
    "stringcontainsstringignoringcase isobject isnumeric nan isresource stringnotequalsfile containsonlystring samesize isiterable stringstartsnotwith " +
    "filenotequals notcount nottrue containsonly isnotarray notisreadable notiswritable directorynotexists directorynotisreadable directorynotiswritable " +
    "filenotexists filenotisreadable filenotiswritable regexp notregexp filematchesformatfile jsonstringequalsjsonfile xmlstringequalsxmlfile " +
    "isclosedresource infinite count json filedoesnotexist directorydoesnotexist objecthasproperty objectnothasproperty matchesregularexpression " +
    "doesnotmatchregularexpression isstring isscalar islist equalsignoringcase notequalscanonicalizing notequalswithdelta objectequals containsequals " +
    "notcontainsequals notsamesize stringendsnotwith stringnotcontainsstringignoringcase isreadable iswritable finite isnotstring isnotobject isnotint " +
    "stringequalsstringignoringlineendings";

export const PHPUNIT: ReadonlySet<string> = new Set(PHPUNIT_NAMES.split(" ").map((n) => `assert${n}`));

/** The classes of webmozart/assert and beberlei/assert, by lowercase full name: their methods are known as PHPUnit's are. */
export const ASSERT_CLASSES: ReadonlySet<string> = new Set(["webmozart\\assert\\assert", "assert\\assertion", "assert\\assert"]);
