import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Roles } from './auth.decorators.js';
import {
  CreateUserSchema,
  UpdateUserSchema,
  type CreateUserDto,
  type UpdateUserDto,
} from './users.dto.js';

/** Gestão de usuários — restrita a admin (ADR 0007). */
@Roles('admin')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.users.remove(id);
  }
}
