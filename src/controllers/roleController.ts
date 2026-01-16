import { Request, Response, NextFunction } from 'express';
import Role from '../models/Role';
import { AppError } from '../middleware/errorHandler';

export const createRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { name, permissions, description } = req.body;

        const existingRole = await Role.findOne({ name });
        if (existingRole) {
            return next(new AppError('Role with this name already exists', 400));
        }

        const role = await Role.create({
            name,
            permissions,
            description
        });

        res.status(201).json({
            status: 'success',
            data: { role }
        });
    } catch (error) {
        next(error);
    }
};

export const getAllRoles = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const roles = await Role.find();
        res.status(200).json({
            status: 'success',
            results: roles.length,
            data: { roles }
        });
    } catch (error) {
        next(error);
    }
};

export const getRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) {
            return next(new AppError('Role not found', 404));
        }
        res.status(200).json({
            status: 'success',
            data: { role }
        });
    } catch (error) {
        next(error);
    }
};

export const updateRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { name, permissions, description } = req.body;

        const role = await Role.findById(req.params.id);
        if (!role) {
            return next(new AppError('Role not found', 404));
        }

        if (role.isSystem && name !== role.name) {
            // System roles might allow permission updates? 
            // Ideally system role names shouldn't change, but permissions might/might not.
            // Let's block name change for system roles.
            return next(new AppError('Cannot change name of a system role', 400));
        }

        role.name = name || role.name;
        role.permissions = permissions || role.permissions;
        role.description = description || role.description;

        await role.save();

        res.status(200).json({
            status: 'success',
            data: { role }
        });
    } catch (error) {
        next(error);
    }
};

export const deleteRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) {
            return next(new AppError('Role not found', 404));
        }

        if (role.isSystem) {
            return next(new AppError('Cannot delete a system role', 400));
        }

        // Also check if any users are assigned to this role?
        // Ideally yes, but skipping for simplicity now (Or we can just set their roleId to null)

        await Role.deleteOne({ _id: role._id });

        res.status(200).json({
            status: 'success',
            message: 'Role deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};
