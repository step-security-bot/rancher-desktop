package main

import (
	"fmt"
	"log"
	"os"
	"sort"
	"strings"
)

type cleanupFunc func() error

// parsedArgs describes the result of calling parseArgs.
type parsedArgs struct {
	// Arguments for nerdctl with paths replaced.
	args []string
	// cleanup functions to call
	cleanup []cleanupFunc
}

// argHandler is the type of a function that handles some argument.
type argHandler func(string) (string, []cleanupFunc, error)

type commandDefinition struct {
	// commandPath is the arguements needed to get to this command.
	commandPath string
	// subcommands that can be spawned from this command.
	subcommands map[string]struct{}
	// options for this (sub) command.  If the handler is null, the option does
	// not take arguments.
	options map[string]argHandler
	// handler for any positional arguments and subcommands.  This should not
	// include the name of the subcommand itself.  If this is not given, all
	// subcommands are searched for, and positional arguments are ignored.
	handler func(*commandDefinition, []string) (*parsedArgs, error)
}

// parseOption takes an argument (that is known to start with `-` or `--`) plus
// the next argument (which may be needed if a value is required), and returns
// whether the value argument was consumed, plus any cleanup functions.
func (c *commandDefinition) parseOption(arg, next string) ([]string, bool, []cleanupFunc, error) {
	if !strings.HasPrefix(arg, "-") {
		panic(fmt.Sprintf("commandDefinition.parseOption called with invalid arg %q", arg))
	}
	// The user may say `-foo` instead of `--foo`; check that first.
	handler, ok := c.options["-"+arg]
	if !ok {
		handler, ok = c.options[arg]
	}
	if ok {
		if handler == nil {
			// This does not consume a value, and therefore doesn't need munging
			return []string{arg}, false, nil, nil
		}
		sep := strings.Index(arg, "=")
		if sep < 0 {
			// A separator is not given, consume the next argument.  Note that
			// cleanups may contain elements on failure.
			converted, cleanups, err := handler(next)
			if err != nil {
				return nil, false, cleanups, err
			}
			return []string{arg, converted}, true, cleanups, nil
		}
		// A separator is given; handle the embedded value.  Note that cleanups
		// may contain elements on failure.
		fixed, cleanups, err := handler(arg[sep+1:])
		if err != nil {
			return nil, false, cleanups, err
		}
		return []string{arg[:sep] + fixed}, false, cleanups, nil
	}
	var extraCleanups []cleanupFunc
	// Check if we can resolve this with the parent command.
	if lastSpace := strings.LastIndex(c.commandPath, " "); lastSpace > -1 {
		parent, ok := commands[c.commandPath[:lastSpace]]
		if !ok {
			panic(fmt.Sprintf("command %q could not find parent %q", c.commandPath, c.commandPath[:lastSpace]))
		}
		parentResult, parentConsumed, parentCleanups, parentErr := parent.parseOption(arg, next)
		if parentErr == nil {
			return parentResult, parentConsumed, parentCleanups, nil
		}
		extraCleanups = parentCleanups
	}
	return nil, false, extraCleanups, fmt.Errorf("command %q does not support option %s", c.commandPath, arg)
}

// parse arguments for this command; this includes options (--long, -x) as well
// as subcommands and positional arguments.
func (c commandDefinition) parse(args []string) (*parsedArgs, error) {
	var result parsedArgs
	for argIndex := 0; argIndex < len(args); argIndex++ {
		arg := args[argIndex]
		if strings.HasPrefix(arg, "-") {
			next := ""
			if argIndex+1 < len(args) {
				next = args[argIndex+1]
			}
			newArgs, consumed, cleanups, err := c.parseOption(arg, next)
			if err != nil {
				// We need to run any cleanups we have so far
				for _, cleanup := range append(cleanups, result.cleanup...) {
					cleanupErr := cleanup()
					if cleanupErr != nil {
						log.Printf("Error running cleanup: %s", cleanupErr)
					}
				}
				return nil, err
			}
			result.args = append(result.args, newArgs...)
			result.cleanup = append(result.cleanup, cleanups...)
			if consumed {
				argIndex++
			}
		} else {
			// Handler positional arguments and subcommands.
			if c.handler != nil {
				log.Printf("Using custom parse handler")
				childResult, err := c.handler(&c, args[argIndex:])
				if err != nil {
					return nil, err
				}
				result.args = append(result.args, childResult.args...)
				result.cleanup = append(result.cleanup, childResult.cleanup...)
				break
			}
			// No custom handler; look for subcommands.
			subcommandPath := c.commandPath
			if subcommandPath != "" {
				subcommandPath += " "
			}
			subcommandPath += arg
			if subcommand, ok := commands[subcommandPath]; ok {
				childResult, err := subcommand.parse(args[argIndex+1:])
				if err != nil {
					return nil, err
				}
				result.args = append(result.args, arg)
				result.args = append(result.args, childResult.args...)
				result.cleanup = append(result.cleanup, childResult.cleanup...)
			} else {
				// No subcommand; ignore positional arguments.
				log.Printf("No command %q, ignoring positional arguments", subcommandPath)
				result.args = append(result.args, args[argIndex:]...)
			}
			break
		}
	}
	return &result, nil
}

type optionDefinition struct {
	// long name for the argument
	long string
	// short name for the argument (optional)
	short string
	// handler to convert values; if unset, this argument does not take a value.
	// It returns the converted value, plus any cleanup functions.
	handler func(string) (string, []func(*parsedArgs) error, error)
}

// parseArgs parses the process arguments (os.Args) and returns them with any
// strings referring to paths replaced with replacements that will work with
// nerdctl (i.e. inside the correct WSL container).
func parseArgs() (*parsedArgs, error) {
	err := prepareParseArgs()
	if err != nil {
		return nil, err
	}
	result, err := commands[""].parse(os.Args[1:])
	if err != nil {
		_ = cleanupParseArgs()
		return nil, err
	}
	return result, nil
}

// ignoredArgHandler handles arguments that do not contain paths.
func ignoredArgHandler(input string) (string, []cleanupFunc, error) {
	return input, nil, nil
}

// registerArgHandler sets option handlers.  This should be called from init()
// to set up any option handlers that need to handle paths.
func registerArgHandler(command, option string, handler argHandler) {
	// Do some extra checking to guard against typos.
	if _, ok := commands[command]; !ok {
		panic(fmt.Sprintf("unknown command %q", command))
	}
	if _, ok := commands[command].options[option]; !ok {
		panic(fmt.Sprintf("command %q does not have option %q", command, option))
	}
	commands[command].options[option] = handler
}

// registerCommandHandler sets handlers for positional arguments.  This should
// be called from init().
func registerCommandHandler(command string, handler func(*commandDefinition, []string) (*parsedArgs, error)) {
	// Do some extra checking to guard against typos.
	if _, ok := commands[command]; !ok {
		panic(fmt.Sprintf("unknown command %q", command))
	}
	c := commands[command]
	c.handler = handler
	commands[command] = c
}

// aliasCommand sets up an alias to a different command.  Both the alias and the
// target command must already exist and have the same options / subcommands (as
// it should already be an alias).  This is normally not needed for the help
// commands, as they do not take any arguments.
func aliasCommand(alias, target string) {
	aliasCommand, ok := commands[alias]
	if !ok {
		panic(fmt.Sprintf("unknown alias command %q", alias))
	}
	targetCommand, ok := commands[target]
	if !ok {
		panic(fmt.Sprintf("unknown target command %q", target))
	}

	// Try harder to check that the commands look similar
	if len(aliasCommand.subcommands) != len(targetCommand.subcommands) {
		panic(fmt.Sprintf("cannot alias %q to %q: different subcommands", alias, target))
	}
	for subcommand := range aliasCommand.subcommands {
		if _, ok := targetCommand.subcommands[subcommand]; !ok {
			panic(fmt.Sprintf("cannot alias %q to %q: missing subcommand %q", alias, target, subcommand))
		}
	}
	if len(aliasCommand.options) != len(targetCommand.options) {
		panic(fmt.Sprintf("cannot alias %q to %q: different options", alias, target))
	}
	for option := range aliasCommand.options {
		if _, ok := targetCommand.options[option]; !ok {
			panic(fmt.Sprintf("cannot alias %q to %q: missing option %q", alias, target, option))
		}
	}

	commands[alias] = commands[target]
}

// describeCommands is a debugging function that prints out all commands.
// This is normally never called, but we keep this implemented as it is useful
// for debugging.
func describeCommands() {
	handlerNames := make(map[string]string)
	handlerNames[fmt.Sprintf("%v", nil)] = "~"
	// The next few lines should ignore govet's "printf" lint because we are
	// intentionally printing a function instead of calling it.
	handlerNames[fmt.Sprintf("%v", ignoredArgHandler)] = "ignored"        //nolint:govet,printf
	handlerNames[fmt.Sprintf("%v", volumeArgHandler)] = "volume"          //nolint:govet,printf
	handlerNames[fmt.Sprintf("%v", filePathArgHandler)] = "file path"     //nolint:govet,printf
	handlerNames[fmt.Sprintf("%v", outputPathArgHandler)] = "output path" //nolint:govet,printf

	log.Println("========== COMMAND STRUCTURE ==========")
	var paths []string
	for path := range commands {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		command := commands[path]
		log.Printf("%-20s %v", path, command.handler) //nolint:govet,printf
		var optionNames []string
		for optionName := range command.options {
			optionNames = append(optionNames, optionName)
		}
		sort.Strings(optionNames)
		for _, optionName := range optionNames {
			handler := command.options[optionName]
			handlerName, ok := handlerNames[fmt.Sprintf("%v", handler)]
			if !ok {
				handlerName = "<invalid handler>"
			}
			log.Printf("%20s %s", optionName, handlerName)
		}
	}
	log.Println("========== END COMMAND STRUCTURE ==========")
}

func init() {
	// Set up the argument handlers
	registerArgHandler("compose", "--file", filePathArgHandler)
	registerArgHandler("compose", "-f", filePathArgHandler)
	registerArgHandler("compose", "--project-directory", filePathArgHandler)
	registerArgHandler("compose", "--env-file", filePathArgHandler)
	registerArgHandler("container run", "--volume", volumeArgHandler)
	registerArgHandler("container run", "-v", volumeArgHandler)
	registerArgHandler("container run", "--env-file", filePathArgHandler)
	registerArgHandler("container run", "--label-file", filePathArgHandler)
	registerArgHandler("container run", "--cidfile", outputPathArgHandler)
	registerArgHandler("container run", "--pidfile", outputPathArgHandler)
	registerArgHandler("image build", "--file", filePathArgHandler)
	registerArgHandler("image build", "-f", filePathArgHandler)
	registerArgHandler("image convert", "--estargz-record-in", filePathArgHandler)
	registerArgHandler("image load", "--input", filePathArgHandler)
	registerArgHandler("image save", "--output", outputPathArgHandler)

	// Set up command handlers
	registerCommandHandler("image build", imageBuildHandler)

	// Set up aliases
	aliasCommand("commit", "container commit")
	aliasCommand("exec", "container exec")
	aliasCommand("kill", "container kill")
	aliasCommand("logs", "container logs")
	aliasCommand("pause", "container pause")
	aliasCommand("port", "container port")
	aliasCommand("rm", "container rm")
	aliasCommand("run", "container run")
	aliasCommand("start", "container start")
	aliasCommand("stop", "container stop")
	aliasCommand("unpause", "container unpause")
	aliasCommand("wait", "container wait")
	aliasCommand("build", "image build")
	aliasCommand("load", "image load")
	aliasCommand("pull", "image pull")
	aliasCommand("push", "image push")
	aliasCommand("save", "image save")
	aliasCommand("tag", "image tag")

	// describeCommands()
}
